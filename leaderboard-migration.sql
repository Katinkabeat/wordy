-- ============================================================
-- WORDY - Leaderboard Migration
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================

-- Returns the all-time high scores across all finished games.
-- Excludes any user whose username contains 'test' (case-insensitive).
-- Returns up to 20 rows, ordered by best single-game score descending.
CREATE OR REPLACE FUNCTION public.get_leaderboard()
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  best_score   INT,
  games_played BIGINT,
  total_wins   BIGINT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    p.id                                                  AS user_id,
    p.username,
    MAX(gp.score)                                         AS best_score,
    COUNT(DISTINCT gp.game_id)                            AS games_played,
    COUNT(DISTINCT CASE WHEN gp.is_winner THEN gp.game_id END) AS total_wins
  FROM public.game_players gp
  JOIN public.profiles p ON p.id = gp.user_id
  JOIN public.games    g ON g.id = gp.game_id
  WHERE g.status = 'finished'
    AND p.username IS NOT NULL
    AND LOWER(p.username) NOT LIKE '%test%'
  GROUP BY p.id, p.username
  ORDER BY best_score DESC
  LIMIT 20
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;
