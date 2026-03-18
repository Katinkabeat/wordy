-- ============================================================
-- FIX: Stats not updating after games
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================
-- Root cause:
--   1. finish_game was done client-side with individual .update() calls.
--      The RLS policy "gp: update own" blocked updating opponents' rows,
--      so is_winner was never set on the winner's row when the LOSER was
--      the one who triggered game-over.  record_game_result then found no
--      winner and exited silently.
--   2. forfeit_game did not call record_game_result at all.
-- ============================================================

-- ── 1. finish_game ────────────────────────────────────────────
-- Called by the client when a game ends naturally.
-- SECURITY DEFINER bypasses RLS so it can write all players' rows.
CREATE OR REPLACE FUNCTION public.finish_game(
  p_game_id       UUID,
  p_player_results JSONB   -- [{user_id, score, is_winner}, ...]
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pr JSONB;
BEGIN
  FOR pr IN SELECT * FROM jsonb_array_elements(p_player_results) LOOP
    UPDATE public.game_players
    SET
      score     = (pr->>'score')::INT,
      is_winner = (pr->>'is_winner')::BOOLEAN
    WHERE game_id = p_game_id
      AND user_id = (pr->>'user_id')::UUID;
  END LOOP;

  -- Record win/loss stats in player_matchups
  PERFORM public.record_game_result(p_game_id);
END;
$$;

-- ── 2. forfeit_game ───────────────────────────────────────────
-- Replaces (or creates) the forfeit function so it also records stats.
-- Preserves the existing behaviour: sets forfeit_user_id, marks winner,
-- marks game finished, then records the result.
CREATE OR REPLACE FUNCTION public.forfeit_game(
  p_game_id         UUID,
  p_forfeit_user_id UUID
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

  -- Mark the game as finished and record who forfeited
  UPDATE public.games
  SET
    status           = 'finished',
    finished_at      = NOW(),
    forfeit_user_id  = p_forfeit_user_id
  WHERE id = p_game_id;

  -- Record win/loss stats in player_matchups
  PERFORM public.record_game_result(p_game_id);
END;
$$;
