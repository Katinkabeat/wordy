-- Fix infinite recursion in game_players policy.
--
-- After wrapping auth.uid() in (SELECT ...), Postgres' RLS recursion detector
-- flagged the games <-> game_players policy cycle:
--   INSERT game_players -> read games -> read game_players ...
--
-- The cycle is broken with a SECURITY DEFINER function that bypasses RLS for
-- the player-membership check. The function only returns true/false; no data
-- leaks because callers already know the game_id they're asking about.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_player_in_game(p_game_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_players
    WHERE game_id = p_game_id AND user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_player_in_game(uuid, uuid) TO authenticated, anon;

-- Rewrite "games: read visible" to call the function instead of querying
-- game_players directly. Logic preserved exactly.
DROP POLICY IF EXISTS "games: read visible" ON public.games;
CREATE POLICY "games: read visible" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      invited_user_ids IS NULL
      OR cardinality(invited_user_ids) = 0
      OR cardinality(invited_user_ids) < (max_players - 1)
      OR (SELECT auth.uid()) = created_by
      OR (SELECT auth.uid()) = ANY (invited_user_ids)
      OR public.is_player_in_game(games.id, (SELECT auth.uid()))
    )
  );

-- Same fix for "games: update player" — also queries game_players.
DROP POLICY IF EXISTS "games: update player" ON public.games;
CREATE POLICY "games: update player" ON public.games
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (public.is_player_in_game(games.id, (SELECT auth.uid())));

-- And "moves: read game" on game_moves — same cross-table read.
DROP POLICY IF EXISTS "moves: read game" ON public.game_moves;
CREATE POLICY "moves: read game" ON public.game_moves
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (public.is_player_in_game(game_moves.game_id, (SELECT auth.uid())));

COMMIT;
