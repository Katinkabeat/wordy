-- ============================================================
-- WORDY — invite-a-friend feature (2026-05-03)
--
-- Adds invited_user_ids[], expires_at, cancelled_at to games.
-- Adds RLS to hide fully-invited games from randos.
-- Adds RLS on game_players INSERT to reserve invitee slots.
-- Adds wordy_cancel_game (creator-only, blocked once moves exist).
-- Adds wordy_auto_start_or_cancel_stale (lazy sweep at timeout).
-- Adds push trigger for invitations.
--
-- Behavior:
--   • invited_user_ids is an array. 0..max_players-1 invitees allowed.
--   • If invited_user_ids has fewer entries than max_players-1, the
--     remaining slots are "unreserved" — anyone can fill them.
--   • Invitee slots are reserved: a non-invitee can only take a slot
--     when (current_players + pending_invitees) < max_players.
--   • Invited timeout = 24h. Open timeout = 7d.
--   • At timeout: if 2+ players joined, auto-start; else auto-cancel.
-- ============================================================

BEGIN;

-- ── columns ──────────────────────────────────────────────────
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS invited_user_ids uuid[],
  ADD COLUMN IF NOT EXISTS expires_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz;

CREATE INDEX IF NOT EXISTS games_expires_idx ON public.games(expires_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS games_invited_gin_idx ON public.games USING gin(invited_user_ids);

-- ── status check update ──────────────────────────────────────
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_status_check;
ALTER TABLE public.games ADD CONSTRAINT games_status_check
  CHECK (status IN ('waiting', 'active', 'finished', 'cancelled', 'expired'));

-- ── auto-set expires_at on insert (24h invited / 7d open) ────
CREATE OR REPLACE FUNCTION public.wordy_set_game_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    IF NEW.invited_user_ids IS NOT NULL AND cardinality(NEW.invited_user_ids) > 0 THEN
      NEW.expires_at := NEW.created_at + INTERVAL '1 day';
    ELSE
      NEW.expires_at := NEW.created_at + INTERVAL '7 days';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_wordy_game_set_expiry ON public.games;
CREATE TRIGGER on_wordy_game_set_expiry
BEFORE INSERT ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.wordy_set_game_expiry();

-- ── games SELECT policy: hide fully-invited games from randos ─
-- "Fully invited" means cardinality(invited_user_ids) >= max_players - 1
-- (no unreserved slots remaining for the public).
DROP POLICY IF EXISTS "games: read all" ON public.games;
DROP POLICY IF EXISTS "games: read visible" ON public.games;

CREATE POLICY "games: read visible" ON public.games FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    invited_user_ids IS NULL
    OR cardinality(invited_user_ids) = 0
    OR cardinality(invited_user_ids) < (max_players - 1)
    OR auth.uid() = created_by
    OR auth.uid() = ANY(invited_user_ids)
    OR EXISTS (
      SELECT 1 FROM public.game_players gp
      WHERE gp.game_id = games.id AND gp.user_id = auth.uid()
    )
  )
);

-- ── game_players INSERT policy: enforce reserved-slot logic ─
-- A non-invitee can only join if there's room beyond pending invitees.
-- An invitee can always join their game.
DROP POLICY IF EXISTS "gp: insert own" ON public.game_players;
DROP POLICY IF EXISTS "gp: insert with slot check" ON public.game_players;

CREATE POLICY "gp: insert with slot check" ON public.game_players FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_id
      AND g.status = 'waiting'
      AND (
        -- Invitee path: always allowed
        (g.invited_user_ids IS NOT NULL AND auth.uid() = ANY(g.invited_user_ids))
        OR
        -- Non-invitee path: only if there's room beyond pending invitees
        (
          (
            (SELECT count(*) FROM public.game_players gp WHERE gp.game_id = g.id) +
            COALESCE((
              SELECT count(*) FROM unnest(g.invited_user_ids) AS i(invitee_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.game_players gp2
                WHERE gp2.game_id = g.id AND gp2.user_id = i.invitee_id
              )
            ), 0)
          ) < g.max_players
        )
      )
  )
);

-- ── wordy_cancel_game: creator-only, blocked once moves exist ─
CREATE OR REPLACE FUNCTION public.wordy_cancel_game(p_game_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_creator uuid;
  v_status  text;
  v_moves   int;
BEGIN
  SELECT created_by, status INTO v_creator, v_status
  FROM public.games WHERE id = p_game_id;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'game not found';
  END IF;

  IF v_creator <> auth.uid() THEN
    RAISE EXCEPTION 'only the creator can cancel this game';
  END IF;

  IF v_status NOT IN ('waiting', 'active') THEN
    RAISE EXCEPTION 'game is not active';
  END IF;

  SELECT count(*) INTO v_moves FROM public.game_moves WHERE game_id = p_game_id;
  IF v_moves > 0 THEN
    RAISE EXCEPTION 'cannot cancel after a move has been played';
  END IF;

  UPDATE public.games
  SET status = 'cancelled',
      cancelled_at = now(),
      finished_at = now()
  WHERE id = p_game_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wordy_cancel_game(uuid) TO authenticated;

-- ── wordy_auto_start_or_cancel_stale ──
-- For each waiting game past expires_at:
--   • 2+ players joined → flip to active, pick random first player
--   • <2 joined        → flip to cancelled
-- Called lazily on each lobby load.
CREATE OR REPLACE FUNCTION public.wordy_auto_start_or_cancel_stale()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_game RECORD;
  v_count int := 0;
  v_player_count int;
  v_first_player int;
BEGIN
  FOR v_game IN
    SELECT id, max_players FROM public.games
    WHERE status = 'waiting'
      AND expires_at IS NOT NULL
      AND expires_at < now()
  LOOP
    SELECT count(*) INTO v_player_count FROM public.game_players WHERE game_id = v_game.id;

    IF v_player_count >= 2 THEN
      v_first_player := floor(random() * v_player_count)::int;
      UPDATE public.games
      SET status = 'active',
          current_player_idx = v_first_player
      WHERE id = v_game.id;
    ELSE
      UPDATE public.games
      SET status = 'cancelled',
          cancelled_at = now(),
          finished_at = now()
      WHERE id = v_game.id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wordy_auto_start_or_cancel_stale() TO authenticated;

-- ── Push trigger: notify invitees on game create ──
-- Fires once per invited_user_id when the row is inserted with a
-- non-empty invited_user_ids array. The Push-Notification edge
-- function handles per-invitee push delivery.
CREATE OR REPLACE FUNCTION public.wordy_notify_game_invited()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.invited_user_ids IS NULL OR cardinality(NEW.invited_user_ids) = 0 THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_invited',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Wordy game_invited push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_wordy_game_invited ON public.games;
CREATE TRIGGER on_wordy_game_invited
AFTER INSERT ON public.games
FOR EACH ROW
WHEN (NEW.invited_user_ids IS NOT NULL AND cardinality(NEW.invited_user_ids) > 0)
EXECUTE FUNCTION public.wordy_notify_game_invited();

COMMIT;
