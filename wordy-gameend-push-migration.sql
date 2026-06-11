-- Game-end push for Wordy (c188).
--
-- GAP: the only push trigger (on_turn_change) fires on an ACTIVE turn change.
-- A claim / forfeit sets status='finished', so no push ever reached the loser
-- (or the surprise winner). This adds the missing game-end push.
--
-- UNIFIED CONTRACT (shared across all SQ games + the scaffold):
--   1. games.end_reason — 'claim' | 'forfeit' stamped by the path that ends
--      the game. NULL for normal completion and admin-close (both stay silent).
--   2. on_game_finished trigger — AFTER UPDATE active->finished, fires only
--      when end_reason is set, POSTs type='game_finished' to the edge fn.
--   3. The edge fn's game_finished handler branches on end_reason, respects
--      notification prefs, and skips bots.
--
-- Run order: after wordy-claim-inactive-migration.sql and fix-stats-sql.sql.

-- ── 1. End-reason marker ──────────────────────────────────────
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS end_reason TEXT;

-- ── 2. forfeit_game gains a reason arg (default 'forfeit') ─────
-- Drop the 2-arg version so only the reason-aware one remains; existing
-- 2-arg callers resolve to it via the default. claim_inactive_win passes
-- 'claim' so the edge fn can tell a claim from a voluntary forfeit.
DROP FUNCTION IF EXISTS public.forfeit_game(UUID, UUID);

CREATE OR REPLACE FUNCTION public.forfeit_game(
  p_game_id         UUID,
  p_forfeit_user_id UUID,
  p_reason          TEXT DEFAULT 'forfeit'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_winner_id UUID;
BEGIN
  -- The winner is whoever is NOT forfeiting
  SELECT user_id INTO v_winner_id
  FROM public.game_players
  WHERE game_id = p_game_id
    AND user_id != p_forfeit_user_id
  LIMIT 1;

  -- Update is_winner flags
  UPDATE public.game_players
  SET is_winner = (user_id = v_winner_id)
  WHERE game_id = p_game_id;

  -- Mark the game as finished, record who forfeited + why it ended
  UPDATE public.games
  SET
    status           = 'finished',
    finished_at      = NOW(),
    forfeit_user_id  = p_forfeit_user_id,
    end_reason       = p_reason
  WHERE id = p_game_id;

  -- Record win/loss stats in player_matchups
  PERFORM public.record_game_result(p_game_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_game(UUID, UUID, TEXT) TO authenticated;

-- ── 3. claim_inactive_win stamps end_reason='claim' ───────────
CREATE OR REPLACE FUNCTION public.claim_inactive_win(
  p_game_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_status  TEXT;
  v_cur_idx INT;
  v_last    TIMESTAMPTZ;
  v_my_idx  INT;
  v_stalled UUID;
BEGIN
  SELECT status, current_player_idx, last_activity_at
    INTO v_status, v_cur_idx, v_last
    FROM public.games
   WHERE id = p_game_id
     FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Game is not active';
  END IF;

  SELECT player_index
    INTO v_my_idx
    FROM public.game_players
   WHERE game_id = p_game_id AND user_id = v_uid;

  IF v_my_idx IS NULL THEN
    RAISE EXCEPTION 'Player is not in this game';
  END IF;
  IF v_my_idx = v_cur_idx THEN
    RAISE EXCEPTION 'It is your turn — you cannot claim';
  END IF;
  IF v_last > NOW() - INTERVAL '7 days' THEN
    RAISE EXCEPTION 'Opponent still has time';
  END IF;

  -- The stalled current player loses. Reuse forfeit_game (reason='claim')
  -- so winner-flagging and stats recording stay identical to a forfeit.
  SELECT user_id INTO v_stalled
    FROM public.game_players
   WHERE game_id = p_game_id AND player_index = v_cur_idx;

  PERFORM public.forfeit_game(p_game_id, v_stalled, 'claim');
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_inactive_win(UUID) TO authenticated;

-- ── 4. Game-end push trigger ──────────────────────────────────
-- Fires only on a claim/forfeit finish (end_reason set). Normal completion
-- and admin-close leave end_reason NULL, so they stay silent.
CREATE OR REPLACE FUNCTION public.notify_game_finished()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Game-end push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_game_finished ON public.games;
CREATE TRIGGER on_game_finished
AFTER UPDATE ON public.games
FOR EACH ROW
WHEN (OLD.status = 'active' AND NEW.status = 'finished' AND NEW.end_reason IS NOT NULL)
EXECUTE FUNCTION public.notify_game_finished();
