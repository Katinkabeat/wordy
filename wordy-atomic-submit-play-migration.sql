-- Atomic word-play / exchange submission for Wordy.
--
-- WHY: submitWord/confirmExchange previously did two independent client-side
-- UPDATEs (games + game_players) in a Promise.all. RLS forces these to be split
-- client-side (a player may only update their own game_players row), so they
-- could not run in one statement. When one half committed and the other failed,
-- the game corrupted: score/rack updated but board/turn did not (or vice versa),
-- and drawn tiles ended up duplicated in both the rack and the bag.
--
-- These SECURITY DEFINER functions run both writes in a single transaction and
-- bypass RLS, so a play is all-or-nothing. A row lock + turn/status guard makes
-- a retry-after-success reject cleanly instead of double-applying.
--
-- Run order: after supabase-schema.sql and fix-stats-sql.sql.

-- ── Place a word ──────────────────────────────────────────────
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
  -- Lock the game row so concurrent submits / retries serialize.
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

-- ── Exchange tiles ────────────────────────────────────────────
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
    status             = CASE WHEN p_is_game_over THEN 'finished' ELSE status      END,
    finished_at        = CASE WHEN p_is_game_over THEN NOW()     ELSE finished_at END
  WHERE id = p_game_id;

  UPDATE public.game_players SET
    rack = p_rack
  WHERE game_id = p_game_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_exchange(UUID, UUID, TEXT[], TEXT[], INT, INT, BOOLEAN) TO authenticated;
