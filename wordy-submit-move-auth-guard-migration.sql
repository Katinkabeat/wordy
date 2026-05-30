-- Caller-identity guard for the atomic move RPCs (c157 security hardening).
--
-- WHY: submit_play() and submit_exchange() are SECURITY DEFINER and take the
-- acting player as p_user_id. They verify it is that player's turn, but they did
-- NOT verify p_user_id = auth.uid(). So any authenticated user could submit a
-- move on behalf of another player by passing a different user_id. Friends-only
-- game, low real-world risk, but a genuine integrity hole.
--
-- FIX: add a guard near the top of each RPC requiring the caller to be the acting
-- player. Everything else (row lock, turn/status check, the two UPDATEs, GRANTs)
-- is preserved exactly as in wordy-atomic-submit-play-migration.sql.
--
-- BOT COMPATIBILITY: a server-side "computer player" bot is coming, and its
-- bot-move edge function will call these SAME RPCs on behalf of bot players using
-- the service_role key. service_role MUST be exempt from the guard. With the
-- service_role key, auth.role() = 'service_role' and auth.uid() IS NULL, so the
-- guard short-circuits before the identity check. (auth.uid() returning the
-- *invoking* user inside a SECURITY DEFINER function is already relied on by
-- public.wordy_cancel_game in wordy-invite-friend-migration.sql.)
--
-- Run order: after wordy-atomic-submit-play-migration.sql.

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
  -- Caller-identity guard: a normal authenticated caller may only submit as
  -- themselves. service_role (the bot-move edge function) is exempt.
  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR p_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Cannot submit a move as another player';
  END IF;

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
  -- Caller-identity guard: a normal authenticated caller may only submit as
  -- themselves. service_role (the bot-move edge function) is exempt.
  IF auth.role() <> 'service_role'
     AND (auth.uid() IS NULL OR p_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Cannot submit a move as another player';
  END IF;

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
