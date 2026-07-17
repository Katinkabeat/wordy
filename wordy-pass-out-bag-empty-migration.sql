-- Pass-out only ends the game when the bag is empty (c289).
--
-- WHY: consecutive passes (2× per player) used to end the game regardless of
-- the bag, and the pass path was a client-side `games` UPDATE that decided
-- game-over in the browser. That enabled pass-out score farming: one word +
-- four passes banks ~100 pts, and a mutual 0–0 pass-out pays both players out
-- (win-trading discussion, c287). The rule change kills the farm at the
-- mechanic: passing out only finishes a game once the tile bag is empty —
-- i.e. a genuine endgame stalemate. Two players who both give up mid-bag use
-- forfeit or the 7-day claim_inactive_win instead.
--
-- HOW:
--   1. submit_pass(game, user) — new SECURITY DEFINER RPC, the atomic-move
--      shape of submit_play/submit_exchange (caller guard, row lock,
--      turn/status checks). It increments consecutive_passes, advances the
--      turn, bumps last_activity_at, and decides game-over SERVER-side:
--        over = new_passes >= player_count * 2 AND tile_bag is empty
--      Returns that boolean so callers know whether to run the finish flow.
--      Replaces the client-side pass UPDATE in useGameMutations.js and the
--      service-role pass UPDATE in bot-move (which never bumped
--      last_activity_at — fixed for free by going through this RPC).
--   2. submit_exchange — recreated with the same signature, but game-over is
--      now computed server-side with the same bag-empty condition;
--      p_is_game_over is IGNORED (kept only so deployed clients keep
--      working). Note an exchange returns tiles to the bag, so the bag is
--      never empty after one — an exchange can no longer be the game-ending
--      move, it only advances the pass counter toward a later pass-out.
--
-- Safe by construction (verified 2026-07-16): bots exchange while the bag has
-- tiles and only pass when it's empty; exchange requires bag >= selection, so
-- a stuck player always has an out; every play resets the counter to 0, so
-- the counter always starts fresh at bag-empty.
--
-- Run order: after wordy-claim-inactive-migration.sql.

-- ── 1. Pass ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_pass(
  p_game_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status       TEXT;
  v_cur_idx      INT;
  v_passes       INT;
  v_bag          TEXT[];
  v_player_idx   INT;
  v_player_count INT;
  v_new_passes   INT;
  v_over         BOOLEAN;
BEGIN
  -- Caller-identity guard: a normal authenticated caller may only submit as
  -- themselves. service_role (the bot-move edge function) is exempt.
  -- coalesce() guards the NULL-role case: a missing role claim makes
  -- auth.role() <> 'service_role' evaluate to NULL (not TRUE), which would
  -- otherwise let the whole AND short-circuit past the guard.
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR p_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Cannot submit a move as another player';
  END IF;

  -- Lock the game row so concurrent submits / retries serialize.
  SELECT status, current_player_idx, consecutive_passes, tile_bag
    INTO v_status, v_cur_idx, v_passes, v_bag
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

  SELECT COUNT(*)
    INTO v_player_count
    FROM public.game_players
   WHERE game_id = p_game_id;

  v_new_passes := COALESCE(v_passes, 0) + 1;
  v_over := v_new_passes >= v_player_count * 2
            AND COALESCE(cardinality(v_bag), 0) = 0;

  UPDATE public.games SET
    current_player_idx = (v_player_idx + 1) % v_player_count,
    consecutive_passes = v_new_passes,
    last_activity_at   = NOW(),
    status             = CASE WHEN v_over THEN 'finished' ELSE status      END,
    finished_at        = CASE WHEN v_over THEN NOW()      ELSE finished_at END
  WHERE id = p_game_id;

  RETURN v_over;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_pass(UUID, UUID) TO authenticated;

-- ── 2. Exchange: game-over now decided server-side ────────────
-- Same signature as before; p_is_game_over is ignored (see header).
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
  v_status       TEXT;
  v_cur_idx      INT;
  v_player_idx   INT;
  v_player_count INT;
  v_over         BOOLEAN;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
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

  SELECT COUNT(*)
    INTO v_player_count
    FROM public.game_players
   WHERE game_id = p_game_id;

  -- Server-authoritative pass-out rule; the p_is_game_over argument is
  -- deliberately not consulted. In practice an exchange puts tiles back in
  -- the bag, so v_over is always false here — kept as the real rule (not a
  -- hardcoded false) so the invariant holds even if the bag math changes.
  v_over := p_consecutive_passes >= v_player_count * 2
            AND COALESCE(cardinality(p_tile_bag), 0) = 0;

  UPDATE public.games SET
    tile_bag           = p_tile_bag,
    current_player_idx = p_current_player_idx,
    consecutive_passes = p_consecutive_passes,
    last_activity_at   = NOW(),
    status             = CASE WHEN v_over THEN 'finished' ELSE status      END,
    finished_at        = CASE WHEN v_over THEN NOW()      ELSE finished_at END
  WHERE id = p_game_id;

  UPDATE public.game_players SET
    rack = p_rack
  WHERE game_id = p_game_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_exchange(UUID, UUID, TEXT[], TEXT[], INT, INT, BOOLEAN) TO authenticated;
