-- Round 2 of the RLS recursion fix.
--
-- The "gp: insert with slot check" policy still recurses because its WITH
-- CHECK queries game_players (for the slot count and pending-invitee check).
-- Even though game_players' SELECT policy is trivial, the static analyzer
-- flags the self-reference. Move the entire slot-check into a SECURITY
-- DEFINER function so the policy itself does not touch game_players.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_join_game(p_game_id uuid, p_user_id uuid, p_invited_user_ids uuid[], p_max_players int)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count int;
  pending_invitee_count int;
BEGIN
  -- Invitee path: always allowed.
  IF p_invited_user_ids IS NOT NULL AND p_user_id = ANY (p_invited_user_ids) THEN
    RETURN true;
  END IF;

  -- Non-invitee path: only if there's room beyond pending invitees.
  SELECT count(*) INTO current_count
  FROM public.game_players
  WHERE game_id = p_game_id;

  SELECT COALESCE(count(*), 0) INTO pending_invitee_count
  FROM unnest(COALESCE(p_invited_user_ids, ARRAY[]::uuid[])) AS i(invitee_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.game_players gp2
    WHERE gp2.game_id = p_game_id AND gp2.user_id = i.invitee_id
  );

  RETURN (current_count + pending_invitee_count) < p_max_players;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_join_game(uuid, uuid, uuid[], int) TO authenticated, anon;

-- Rewrite the INSERT policy: just check auth + that the game is waiting +
-- delegate the slot logic to the function. No more game_players self-refs.
DROP POLICY IF EXISTS "gp: insert with slot check" ON public.game_players;
CREATE POLICY "gp: insert with slot check" ON public.game_players
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = game_players.game_id
        AND g.status = 'waiting'
        AND public.can_join_game(g.id, (SELECT auth.uid()), g.invited_user_ids, g.max_players)
    )
  );

COMMIT;
