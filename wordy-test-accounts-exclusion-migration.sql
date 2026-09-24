-- c332: Test Accounts group must never count on any leaderboard/stat, and
-- any multiplayer game with a test account seated is ignored for BOTH
-- players (a real player's games vs a test account don't count for them
-- either).
--
-- public.sq_is_test_account(uid uuid) already exists (SECURITY DEFINER,
-- STABLE) and is TRUE for members of the "test-accounts" user group.
-- The rook_* stat/hype functions and get_sq_stats() were already patched
-- for c332 (see their `-- c332` comments in the live DB). This migration
-- catches the remaining unpatched aggregates:
--
--   1. get_leaderboard()          - swap the `%test%` username sniff for
--                                    sq_is_test_account(), and add a
--                                    game-level exclusion (mirrors the
--                                    existing any-bot-in-game NOT EXISTS).
--   2. record_game_result(uuid)   - early-return (no player_matchups
--                                    write) if any seated player is a
--                                    test account. Called by finish_game,
--                                    forfeit_game (and transitively
--                                    claim_inactive_win, which calls
--                                    forfeit_game) via PERFORM, so a
--                                    silent no-op is safe - none of those
--                                    callers use the return value.
--   3. record_bot_game_result(uuid) - same early-return; called by
--                                    finish_game the same way.
--   4. record_solo_result(uuid,bool) - legacy solo-vs-bot path; same
--                                    early-return if the human is a test
--                                    account.
--
-- All other functions touching player_matchups / game_players
-- (admin_list_open_games, admin_list_closed_games, auto_start_game,
-- can_join_game, create_game_with_bots, is_player_in_game,
-- notify_bot_move, quit_solo_game, submit_exchange, submit_pass,
-- submit_play, wordy_auto_start_or_cancel_stale, wordy_decline_invite,
-- wordy_pending_for, _erase_account) are game-mechanics/admin-listing
-- functions, not leaderboard/stat aggregates, and are left untouched.

-- 1. get_leaderboard(): test-account filter + game-level exclusion
CREATE OR REPLACE FUNCTION public.get_leaderboard()
 RETURNS TABLE(user_id uuid, username text, best_score integer, games_played bigint, total_wins bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    p.id                                                        AS user_id,
    p.username,
    MAX(gp.score)                                               AS best_score,
    COUNT(DISTINCT gp.game_id)                                  AS games_played,
    COUNT(DISTINCT CASE WHEN gp.is_winner THEN gp.game_id END)  AS total_wins
  FROM public.game_players gp
  JOIN public.profiles p ON p.id = gp.user_id
  JOIN public.games    g ON g.id = gp.game_id
  WHERE g.status = 'finished'
    AND p.username IS NOT NULL
    AND p.is_bot IS NOT TRUE
    AND NOT public.sq_is_test_account(p.id)  -- c332
    AND NOT EXISTS (
      SELECT 1 FROM public.game_players gp2
      JOIN public.profiles p2 ON p2.id = gp2.user_id
      WHERE gp2.game_id = g.id AND p2.is_bot = TRUE
    )
    AND NOT EXISTS (  -- c332: no test account seated in the game
      SELECT 1 FROM public.game_players gp3
      WHERE gp3.game_id = g.id AND public.sq_is_test_account(gp3.user_id)
    )
  GROUP BY p.id, p.username
  ORDER BY best_score DESC
  LIMIT 20
$function$;

-- 2. record_game_result(uuid): skip writing player_matchups for a game
--    with any test account seated
CREATE OR REPLACE FUNCTION public.record_game_result(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  winner_id UUID;
  player_rec RECORD;
  opp_rec RECORD;
BEGIN
  -- c332: never record matchup stats for a game with a test account seated
  IF EXISTS (
    SELECT 1 FROM public.game_players gp
    WHERE gp.game_id = p_game_id AND public.sq_is_test_account(gp.user_id)
  ) THEN
    RETURN;
  END IF;

  SELECT user_id INTO winner_id FROM public.game_players
  WHERE game_id = p_game_id AND is_winner = TRUE LIMIT 1;
  IF winner_id IS NULL THEN RETURN; END IF;
  FOR player_rec IN SELECT user_id FROM public.game_players WHERE game_id = p_game_id
  LOOP
    FOR opp_rec IN SELECT user_id FROM public.game_players WHERE game_id = p_game_id AND user_id != player_rec.user_id
    LOOP
      INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
      VALUES (player_rec.user_id, opp_rec.user_id,
        CASE WHEN player_rec.user_id = winner_id THEN 1 ELSE 0 END,
        CASE WHEN player_rec.user_id != winner_id THEN 1 ELSE 0 END, NOW())
      ON CONFLICT (player_id, opponent_id) DO UPDATE SET
        wins = player_matchups.wins + EXCLUDED.wins,
        losses = player_matchups.losses + EXCLUDED.losses,
        updated_at = NOW();
    END LOOP;
  END LOOP;
END;
$function$;

-- 3. record_bot_game_result(uuid): skip writing player_matchups for a game
--    with any test account seated
CREATE OR REPLACE FUNCTION public.record_bot_game_result(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h RECORD; b RECORD;
BEGIN
  -- c332: never record matchup stats for a game with a test account seated
  IF EXISTS (
    SELECT 1 FROM public.game_players gp
    WHERE gp.game_id = p_game_id AND public.sq_is_test_account(gp.user_id)
  ) THEN
    RETURN;
  END IF;

  FOR h IN
    SELECT gp.user_id, gp.score FROM public.game_players gp
    JOIN public.profiles p ON p.id = gp.user_id
    WHERE gp.game_id = p_game_id AND p.is_bot IS NOT TRUE
  LOOP
    FOR b IN
      SELECT gp.user_id, gp.score FROM public.game_players gp
      JOIN public.profiles p ON p.id = gp.user_id
      WHERE gp.game_id = p_game_id AND p.is_bot = TRUE
    LOOP
      INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
      VALUES (h.user_id, b.user_id,
              CASE WHEN h.score > b.score THEN 1 ELSE 0 END,
              CASE WHEN h.score > b.score THEN 0 ELSE 1 END, NOW())
      ON CONFLICT (player_id, opponent_id) DO UPDATE
        SET wins = player_matchups.wins + EXCLUDED.wins,
            losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();

      INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
      VALUES (b.user_id, h.user_id,
              CASE WHEN b.score > h.score THEN 1 ELSE 0 END,
              CASE WHEN b.score > h.score THEN 0 ELSE 1 END, NOW())
      ON CONFLICT (player_id, opponent_id) DO UPDATE
        SET wins = player_matchups.wins + EXCLUDED.wins,
            losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();
    END LOOP;
  END LOOP;
END $function$;

-- 4. record_solo_result(uuid,bool) (legacy solo-vs-bot path): skip writing
--    player_matchups if the human is a test account
CREATE OR REPLACE FUNCTION public.record_solo_result(p_bot_id uuid, p_human_won boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_human UUID := auth.uid();
BEGIN
  IF v_human IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_bot_id AND is_bot) THEN
    RAISE EXCEPTION 'Opponent is not a computer player';
  END IF;

  -- c332: never record matchup stats for a test account
  IF public.sq_is_test_account(v_human) THEN
    RETURN;
  END IF;

  -- human's record vs the bot
  INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
  VALUES (v_human, p_bot_id,
          CASE WHEN p_human_won THEN 1 ELSE 0 END,
          CASE WHEN p_human_won THEN 0 ELSE 1 END, NOW())
  ON CONFLICT (player_id, opponent_id) DO UPDATE
    SET wins = player_matchups.wins + EXCLUDED.wins,
        losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();

  -- mirror (bot's record vs the human) for symmetry
  INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
  VALUES (p_bot_id, v_human,
          CASE WHEN p_human_won THEN 0 ELSE 1 END,
          CASE WHEN p_human_won THEN 1 ELSE 0 END, NOW())
  ON CONFLICT (player_id, opponent_id) DO UPDATE
    SET wins = player_matchups.wins + EXCLUDED.wins,
        losses = player_matchups.losses + EXCLUDED.losses, updated_at = NOW();
END $function$;
