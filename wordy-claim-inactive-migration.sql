-- Claim-inactive-win for Wordy (c153).
--
-- WHY: there was no way to end a game stalled on an opponent who stopped
-- playing. Other SQ games (Yahdle, Snibble) let you claim the win once the
-- opponent has been inactive past a 7-day threshold; Wordy had neither the
-- activity tracking nor the claim path. This adds both.
--
-- HOW:
--   1. games.last_activity_at — bumped on every move/exchange/pass. It marks
--      when the CURRENT player's turn started (i.e. when the opponent last
--      acted), so "now - last_activity_at" measures how long the current
--      player has been sitting.
--   2. claim_inactive_win(game) — a non-current participant can claim once
--      that gap exceeds 7 days. The stalled current player is treated as the
--      forfeiter; we reuse forfeit_game so winner-flagging + stats recording
--      stay identical to a normal forfeit.
--
-- Run order: after wordy-atomic-submit-play-migration.sql and fix-stats-sql.sql.
-- (Re-creates submit_play / submit_exchange to add the timestamp bump — bodies
--  are otherwise identical to wordy-atomic-submit-play-migration.sql.)

-- ── 1. Activity timestamp ─────────────────────────────────────
-- DEFAULT now() backfills existing rows; for in-flight games this just
-- restarts the 7-day clock from migration time, which is safe (no early claims).
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Stamp last_activity_at on the atomic move RPCs ─────────
CREATE OR REPLACE FUNCTION public.submit_play(
  p_game_id            UUID,
  p_user_id            UUID,
  p_board              JSONB,
  p_tile_bag           TEXT[],
  p_rack               TEXT[],
  p_score              INT,
  p_current_player_idx INT,
  p_is_game_over       BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status     TEXT;
  v_cur_idx    INT;
  v_player_idx INT;
BEGIN
  SELECT status, current_player_idx
    INTO v_status, v_cur_idx
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
    INTO v_player_idx
    FROM public.game_players
   WHERE game_id = p_game_id AND user_id = p_user_id;

  IF v_player_idx IS NULL THEN
    RAISE EXCEPTION 'Player is not in this game';
  END IF;
  IF v_cur_idx <> v_player_idx THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  UPDATE public.games SET
    board              = p_board,
    tile_bag           = p_tile_bag,
    current_player_idx = p_current_player_idx,
    consecutive_passes = 0,
    last_activity_at   = NOW(),
    status             = CASE WHEN p_is_game_over THEN 'finished' ELSE status      END,
    finished_at        = CASE WHEN p_is_game_over THEN NOW()     ELSE finished_at END
  WHERE id = p_game_id;

  UPDATE public.game_players SET
    score = p_score,
    rack  = p_rack
  WHERE game_id = p_game_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_play(UUID, UUID, JSONB, TEXT[], TEXT[], INT, INT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_exchange(
  p_game_id            UUID,
  p_user_id            UUID,
  p_tile_bag           TEXT[],
  p_rack               TEXT[],
  p_current_player_idx INT,
  p_consecutive_passes INT,
  p_is_game_over       BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status     TEXT;
  v_cur_idx    INT;
  v_player_idx INT;
BEGIN
  SELECT status, current_player_idx
    INTO v_status, v_cur_idx
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
    INTO v_player_idx
    FROM public.game_players
   WHERE game_id = p_game_id AND user_id = p_user_id;

  IF v_player_idx IS NULL THEN
    RAISE EXCEPTION 'Player is not in this game';
  END IF;
  IF v_cur_idx <> v_player_idx THEN
    RAISE EXCEPTION 'Not your turn';
  END IF;

  UPDATE public.games SET
    tile_bag           = p_tile_bag,
    current_player_idx = p_current_player_idx,
    consecutive_passes = p_consecutive_passes,
    last_activity_at   = NOW(),
    status             = CASE WHEN p_is_game_over THEN 'finished' ELSE status      END,
    finished_at        = CASE WHEN p_is_game_over THEN NOW()     ELSE finished_at END
  WHERE id = p_game_id;

  UPDATE public.game_players SET
    rack = p_rack
  WHERE game_id = p_game_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_exchange(UUID, UUID, TEXT[], TEXT[], INT, INT, BOOLEAN) TO authenticated;

-- ── 3. Claim the win on a stalled game ────────────────────────
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

  -- The stalled current player loses. Reuse forfeit_game so winner-flagging
  -- and stats recording stay identical to a normal forfeit.
  SELECT user_id INTO v_stalled
    FROM public.game_players
   WHERE game_id = p_game_id AND player_index = v_cur_idx;

  PERFORM public.forfeit_game(p_game_id, v_stalled);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_inactive_win(UUID) TO authenticated;
