-- Reduce IO from lobby reads.
-- The "games: read visible" RLS policy evaluates cardinality(invited_user_ids)
-- on every games row touched by a SELECT. The lobby query also filters by
-- status, but without a partial index Postgres scans more pages than it needs
-- to. This partial index covers the common case (open public waiting games)
-- so the planner can return them without touching invited or finished rows.

CREATE INDEX IF NOT EXISTS games_lobby_public_waiting_idx
  ON public.games (created_at DESC)
  WHERE status = 'waiting'
    AND (invited_user_ids IS NULL OR cardinality(invited_user_ids) = 0);

ANALYZE public.games;
