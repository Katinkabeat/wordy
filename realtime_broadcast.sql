-- Wordy: Realtime via "Broadcast from database" (realtime.send) instead of
-- postgres_changes. Idempotent; safe to re-run.
--
-- Topics (prefixed because the Supabase project is shared with other SQ games):
--   wordy:game:<game_id>   everyone in (or who created) that game
--   wordy:user:<user_id>   lobby feed for one user
-- Event name: 'change'. Payload:
--   { table, event, game_id, user_id?, status,
--     new: { id, status, created_by, close_reason, closed_by_admin, forfeit_user_id } }
-- (`new` is only present for table = 'games'; game_players events carry
--  game_id/user_id and clients just refetch.)

-- ── 1. Trigger function ──────────────────────────────────────
create or replace function public.wordy_broadcast_game_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_status  text;
  v_creator uuid;
  v_payload jsonb;
  v_uid     uuid;
begin
  if TG_TABLE_NAME = 'games' then
    v_game_id := NEW.id;
    v_status  := NEW.status;
    v_creator := NEW.created_by;
    v_payload := jsonb_build_object(
      'table',   'games',
      'event',   TG_OP,
      'game_id', v_game_id,
      'status',  v_status,
      'new', jsonb_build_object(
        'id',              NEW.id,
        'status',          NEW.status,
        'created_by',      NEW.created_by,
        'close_reason',    to_jsonb(NEW) -> 'close_reason',
        'closed_by_admin', to_jsonb(NEW) -> 'closed_by_admin',
        'forfeit_user_id', to_jsonb(NEW) -> 'forfeit_user_id'
      )
    );
  else
    -- game_players: use OLD on DELETE (NEW is null there)
    if TG_OP = 'DELETE' then
      v_game_id := OLD.game_id;
      v_uid     := OLD.user_id;
    else
      v_game_id := NEW.game_id;
      v_uid     := NEW.user_id;
    end if;
    if v_game_id is null then
      return coalesce(NEW, OLD);
    end if;
    select g.status, g.created_by into v_status, v_creator
      from public.games g where g.id = v_game_id;
    v_payload := jsonb_build_object(
      'table',   'game_players',
      'event',   TG_OP,
      'game_id', v_game_id,
      'user_id', v_uid,
      'status',  v_status
    );
  end if;

  begin
    perform realtime.send(v_payload, 'change', 'wordy:game:' || v_game_id::text, true);

    -- One lobby message per distinct user: every player in the game, the
    -- creator, and (game_players events) the row's own user, who may have just
    -- been removed from the table.
    for v_uid in
      select gp.user_id from public.game_players gp where gp.game_id = v_game_id
      union
      select v_creator where v_creator is not null
      union
      select v_uid where v_uid is not null
    loop
      perform realtime.send(v_payload, 'change', 'wordy:user:' || v_uid::text, true);
    end loop;
  exception when others then
    -- A Realtime hiccup must never abort the game write.
    raise warning 'wordy_broadcast_game_change failed: %', sqlerrm;
  end;

  return coalesce(NEW, OLD);
end;
$$;

-- ── 2. Triggers ──────────────────────────────────────────────
drop trigger if exists wordy_games_broadcast on public.games;
create trigger wordy_games_broadcast
  after update on public.games
  for each row execute function public.wordy_broadcast_game_change();

drop trigger if exists wordy_game_players_broadcast on public.game_players;
create trigger wordy_game_players_broadcast
  after insert or update or delete on public.game_players
  for each row execute function public.wordy_broadcast_game_change();

-- ── 3. Realtime authorization (private channels) ─────────────
-- SECURITY DEFINER helper so the policy doesn't recurse through
-- game_players RLS. Ignores malformed topics instead of erroring.
create or replace function public.wordy_can_read_game_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_topic ~ '^wordy:game:[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.games g
      where g.id = substr(p_topic, 12)::uuid
        and (
          g.created_by = (select auth.uid())
          or exists (
            select 1 from public.game_players gp
            where gp.game_id = g.id and gp.user_id = (select auth.uid())
          )
        )
    );
$$;

drop policy if exists "wordy_realtime_game_topic_select" on realtime.messages;
create policy "wordy_realtime_game_topic_select"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and public.wordy_can_read_game_topic(realtime.topic())
  );

drop policy if exists "wordy_realtime_user_topic_select" on realtime.messages;
create policy "wordy_realtime_user_topic_select"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and realtime.topic() = 'wordy:user:' || (select auth.uid())::text
  );

-- ── 4. NOT EXECUTED: run only AFTER the broadcast client has shipped ──
-- Removes the old postgres_changes sources (WAL decode load). Running this
-- earlier would break clients still on the old build (they fall back to the
-- 10s/60s polls).
-- alter publication supabase_realtime drop table public.games, public.game_players, public.game_moves;
