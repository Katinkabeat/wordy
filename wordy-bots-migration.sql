-- ============================================================
--  Wordy computer players — server-side bot system (cards c162 + c163)
--
--  Adds: is_bot flag, the 4 bot accounts, leaderboard exclusion,
--  the personal "vs character" record RPC, and the turn-change
--  trigger that fires the bot-move edge function when it's a bot's
--  turn.
--
--  Shared prod: yyhewndblruwxsrqzart. Apply with Rae's confirmation.
--  The auth.users seed (section 2) is the riskiest part — test in a
--  transaction / dashboard first; if a GoTrue column is required that
--  isn't defaulted here, fall back to creating the 4 accounts via the
--  Admin API and copy their ids into src/lib/botAccounts.js.
-- ============================================================

-- 1. is_bot flag --------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Bot accounts (real auth.users rows with fixed ids) -----------------------
--    Disabled-password system accounts that never log in. Idempotent.
DO $$
DECLARE b RECORD;
BEGIN
  FOR b IN SELECT * FROM (VALUES
    ('b0700001-0000-4000-8000-000000000001'::uuid, 'robin@bots.wordy.local',     'Robin',     145),
    ('b0700002-0000-4000-8000-000000000002'::uuid, 'jay@bots.wordy.local',       'Jay',       210),
    ('b0700003-0000-4000-8000-000000000003'::uuid, 'merlin@bots.wordy.local',    'Merlin',     25),
    ('b0700004-0000-4000-8000-000000000004'::uuid, 'claudette@bots.wordy.local', 'Claudette', 320)
  ) AS t(id, email, username, hue)
  LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) VALUES (
      b.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      b.email, crypt(gen_random_uuid()::text, gen_salt('bf')),
      NOW(), NOW(), NOW(),
      '{"provider":"bot","providers":["bot"]}'::jsonb,
      jsonb_build_object('username', b.username), FALSE
    )
    ON CONFLICT (id) DO NOTHING;

    -- handle_new_user() may have created a profile from the metadata above;
    -- upsert to guarantee the username/hue and set is_bot.
    INSERT INTO public.profiles (id, username, avatar_hue, tile_hue, is_bot)
    VALUES (b.id, b.username, b.hue, b.hue, TRUE)
    ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username, avatar_hue = EXCLUDED.avatar_hue, is_bot = TRUE;
  END LOOP;
END $$;

-- 3. Leaderboard exclusion ----------------------------------------------------
--    Drop bots from standings AND drop any game that contains a bot (no farming).
CREATE OR REPLACE FUNCTION public.get_leaderboard()
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  best_score   INT,
  games_played BIGINT,
  total_wins   BIGINT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    p.id                                                        AS user_id,
    p.username,
    MAX(gp.score)                                               AS best_score,
    COUNT(DISTINCT gp.game_id)                                  AS games_played,
    COUNT(DISTINCT CASE WHEN gp.is_winner THEN gp.game_id END)  AS total_wins
  FROM public.game_players gp
  JOIN public.profiles p ON p.id = gp.user_id
  JOIN public.games    g ON g.id = gp.game_id
  WHERE g.status = 'finished'
    AND p.username IS NOT NULL
    AND p.is_bot IS NOT TRUE
    AND LOWER(p.username) NOT LIKE '%test%'
    AND NOT EXISTS (
      SELECT 1 FROM public.game_players gp2
      JOIN public.profiles p2 ON p2.id = gp2.user_id
      WHERE gp2.game_id = g.id AND p2.is_bot = TRUE
    )
  GROUP BY p.id, p.username
  ORDER BY best_score DESC
  LIMIT 20
$$;

-- 4. Personal "vs character" record -------------------------------------------
--    Called by the client when a client-side Solo game ends. Records the human's
--    win/loss vs a bot in player_matchups (the private head-to-head store).
CREATE OR REPLACE FUNCTION public.record_solo_result(p_bot_id UUID, p_human_won BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_human UUID := auth.uid();
BEGIN
  IF v_human IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_bot_id AND is_bot) THEN
    RAISE EXCEPTION 'Opponent is not a computer player';
  END IF;

  -- human's record vs the bot
  INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
  VALUES (v_human, p_bot_id,
          CASE WHEN p_human_won THEN 1 ELSE 0 END,
          CASE WHEN p_human_won THEN 0 ELSE 1 END, NOW())
  ON CONFLICT (player_id, opponent_id) DO UPDATE
    SET wins = player_matchups.wins + EXCLUDED.wins,
        losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();

  -- mirror (bot's record vs the human) for symmetry
  INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
  VALUES (p_bot_id, v_human,
          CASE WHEN p_human_won THEN 0 ELSE 1 END,
          CASE WHEN p_human_won THEN 1 ELSE 0 END, NOW())
  ON CONFLICT (player_id, opponent_id) DO UPDATE
    SET wins = player_matchups.wins + EXCLUDED.wins,
        losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();
END $$;
GRANT EXECUTE ON FUNCTION public.record_solo_result(UUID, BOOLEAN) TO authenticated;

-- 5. Bot-move trigger ---------------------------------------------------------
--    When the turn lands on a bot's seat, ping the bot-move edge function.
--    The is_bot check lives in the body (WHEN can only see NEW/OLD).
CREATE OR REPLACE FUNCTION public.notify_bot_move()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_is_bot BOOLEAN;
BEGIN
  SELECT pr.is_bot INTO v_is_bot
  FROM public.game_players gp
  JOIN public.profiles pr ON pr.id = gp.user_id
  WHERE gp.game_id = NEW.id AND gp.player_index = NEW.current_player_idx;

  IF v_is_bot IS TRUE THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/bot-move',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
        ),
        body := jsonb_build_object('record', row_to_json(NEW))
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bot-move trigger failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_bot_turn ON public.games;
CREATE TRIGGER on_bot_turn
AFTER UPDATE ON public.games
FOR EACH ROW
WHEN (NEW.status = 'active' AND OLD.current_player_idx IS DISTINCT FROM NEW.current_player_idx)
EXECUTE FUNCTION public.notify_bot_move();

-- NOTE: the first move when a bot holds seat 0 and the random first player is
-- also 0 won't fire (idx didn't change). That path only matters once bots can
-- join real multiplayer games (c159); handle it there.
