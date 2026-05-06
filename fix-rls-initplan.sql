-- Fix Auth RLS Initialization Plan warnings.
-- Wraps auth.uid()/auth.role()/auth.jwt() in (SELECT ...) so Postgres
-- caches the result per query instead of evaluating per row.
-- Generated from pg_policies dump on 2026-05-06.

BEGIN;

DROP POLICY IF EXISTS "admins: read own" ON public.admins;
CREATE POLICY "admins: read own" ON public.admins
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "announcements_delete_master" ON public.announcements;
CREATE POLICY "announcements_delete_master" ON public.announcements
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "announcements_insert_master" ON public.announcements;
CREATE POLICY "announcements_insert_master" ON public.announcements
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "announcements_select_all_master" ON public.announcements;
CREATE POLICY "announcements_select_all_master" ON public.announcements
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "announcements_update_master" ON public.announcements;
CREATE POLICY "announcements_update_master" ON public.announcements
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "friendships_select_own" ON public.friendships;
CREATE POLICY "friendships_select_own" ON public.friendships
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_a = (SELECT auth.uid())) OR (user_b = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "moves: insert own" ON public.game_moves;
CREATE POLICY "moves: insert own" ON public.game_moves
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "moves: read game" ON public.game_moves;
CREATE POLICY "moves: read game" ON public.game_moves
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM game_players
  WHERE ((game_players.game_id = game_moves.game_id) AND (game_players.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "gp: insert with slot check" ON public.game_players;
CREATE POLICY "gp: insert with slot check" ON public.game_players
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((((SELECT auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM games g
  WHERE ((g.id = game_players.game_id) AND (g.status = 'waiting'::text) AND (((g.invited_user_ids IS NOT NULL) AND ((SELECT auth.uid()) = ANY (g.invited_user_ids))) OR ((( SELECT count(*) AS count
           FROM game_players gp
          WHERE (gp.game_id = g.id)) + COALESCE(( SELECT count(*) AS count
           FROM unnest(g.invited_user_ids) i(invitee_id)
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM game_players gp2
                  WHERE ((gp2.game_id = g.id) AND (gp2.user_id = i.invitee_id)))))), (0)::bigint)) < g.max_players)))))));

DROP POLICY IF EXISTS "gp: read all" ON public.game_players;
CREATE POLICY "gp: read all" ON public.game_players
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) IS NOT NULL));

DROP POLICY IF EXISTS "gp: update own" ON public.game_players;
CREATE POLICY "gp: update own" ON public.game_players
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "games: insert auth" ON public.games;
CREATE POLICY "games: insert auth" ON public.games
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = created_by));

DROP POLICY IF EXISTS "games: read visible" ON public.games;
CREATE POLICY "games: read visible" ON public.games
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((((SELECT auth.uid()) IS NOT NULL) AND ((invited_user_ids IS NULL) OR (cardinality(invited_user_ids) = 0) OR (cardinality(invited_user_ids) < (max_players - 1)) OR ((SELECT auth.uid()) = created_by) OR ((SELECT auth.uid()) = ANY (invited_user_ids)) OR (EXISTS ( SELECT 1
   FROM game_players gp
  WHERE ((gp.game_id = games.id) AND (gp.user_id = (SELECT auth.uid()))))))));

DROP POLICY IF EXISTS "games: update player" ON public.games;
CREATE POLICY "games: update player" ON public.games
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM game_players
  WHERE ((game_players.game_id = games.id) AND (game_players.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "games_catalog_insert_master" ON public.games_catalog;
CREATE POLICY "games_catalog_insert_master" ON public.games_catalog
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "games_catalog_select_all_master" ON public.games_catalog;
CREATE POLICY "games_catalog_select_all_master" ON public.games_catalog
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "games_catalog_update_master" ON public.games_catalog;
CREATE POLICY "games_catalog_update_master" ON public.games_catalog
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "matchups: read own" ON public.player_matchups;
CREATE POLICY "matchups: read own" ON public.player_matchups
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = player_id));

DROP POLICY IF EXISTS "profiles: read all" ON public.profiles;
CREATE POLICY "profiles: read all" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) IS NOT NULL));

DROP POLICY IF EXISTS "profiles: update own" ON public.profiles;
CREATE POLICY "profiles: update own" ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = id));

DROP POLICY IF EXISTS "push_subs: delete own" ON public.push_subscriptions;
CREATE POLICY "push_subs: delete own" ON public.push_subscriptions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "push_subs: insert own" ON public.push_subscriptions;
CREATE POLICY "push_subs: insert own" ON public.push_subscriptions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "push_subs: read own" ON public.push_subscriptions;
CREATE POLICY "push_subs: read own" ON public.push_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "push_subs: update own" ON public.push_subscriptions;
CREATE POLICY "push_subs: update own" ON public.push_subscriptions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "reports_select_admin" ON public.reports;
CREATE POLICY "reports_select_admin" ON public.reports
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM admins a
  WHERE ((a.user_id = (SELECT auth.uid())) AND (a.is_master OR ('manage_reports'::text = ANY (a.permissions)))))));

DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
CREATE POLICY "reports_select_own" ON public.reports
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((reporter = (SELECT auth.uid())));

DROP POLICY IF EXISTS "reports_update_admin" ON public.reports;
CREATE POLICY "reports_update_admin" ON public.reports
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM admins a
  WHERE ((a.user_id = (SELECT auth.uid())) AND (a.is_master OR ('manage_reports'::text = ANY (a.permissions)))))));

DROP POLICY IF EXISTS "games_select_visible" ON public.rg_games;
CREATE POLICY "games_select_visible" ON public.rg_games
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((invited_user_id IS NULL) OR ((SELECT auth.uid()) = created_by) OR ((SELECT auth.uid()) = invited_user_id)));

DROP POLICY IF EXISTS "racks_select_own" ON public.rg_racks;
CREATE POLICY "racks_select_own" ON public.rg_racks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "rg_solo_games_insert_own" ON public.rg_solo_games;
CREATE POLICY "rg_solo_games_insert_own" ON public.rg_solo_games
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "sn_app_settings write for admins" ON public.sn_app_settings;
CREATE POLICY "sn_app_settings write for admins" ON public.sn_app_settings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "sn_daily_feeds delete own" ON public.sn_daily_feeds;
CREATE POLICY "sn_daily_feeds delete own" ON public.sn_daily_feeds
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_daily_feeds read own" ON public.sn_daily_feeds;
CREATE POLICY "sn_daily_feeds read own" ON public.sn_daily_feeds
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_daily_feeds update own" ON public.sn_daily_feeds;
CREATE POLICY "sn_daily_feeds update own" ON public.sn_daily_feeds
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_daily_feeds write own" ON public.sn_daily_feeds;
CREATE POLICY "sn_daily_feeds write own" ON public.sn_daily_feeds
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_match_round_plays read participant" ON public.sn_match_round_plays;
CREATE POLICY "sn_match_round_plays read participant" ON public.sn_match_round_plays
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM sn_matches m
  WHERE ((m.id = sn_match_round_plays.match_id) AND ((m.creator_id = (SELECT auth.uid())) OR (m.opponent_id = (SELECT auth.uid())))))));

DROP POLICY IF EXISTS "sn_match_round_plays write own" ON public.sn_match_round_plays;
CREATE POLICY "sn_match_round_plays write own" ON public.sn_match_round_plays
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_match_rounds insert participant" ON public.sn_match_rounds;
CREATE POLICY "sn_match_rounds insert participant" ON public.sn_match_rounds
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sn_matches m
  WHERE ((m.id = sn_match_rounds.match_id) AND ((m.creator_id = (SELECT auth.uid())) OR (m.opponent_id = (SELECT auth.uid())))))));

DROP POLICY IF EXISTS "sn_match_rounds read participant" ON public.sn_match_rounds;
CREATE POLICY "sn_match_rounds read participant" ON public.sn_match_rounds
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM sn_matches m
  WHERE ((m.id = sn_match_rounds.match_id) AND ((m.creator_id = (SELECT auth.uid())) OR (m.opponent_id = (SELECT auth.uid())))))));

DROP POLICY IF EXISTS "sn_matches admin delete" ON public.sn_matches;
CREATE POLICY "sn_matches admin delete" ON public.sn_matches
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM admins a
  WHERE (a.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "sn_matches insert as creator" ON public.sn_matches;
CREATE POLICY "sn_matches insert as creator" ON public.sn_matches
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = creator_id));

DROP POLICY IF EXISTS "sn_matches join open" ON public.sn_matches;
CREATE POLICY "sn_matches join open" ON public.sn_matches
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((status = 'open'::text) AND (opponent_id IS NULL) AND (creator_id <> (SELECT auth.uid()))))
  WITH CHECK (((opponent_id = (SELECT auth.uid())) AND (status = 'in_progress'::text)));

DROP POLICY IF EXISTS "sn_matches read visible" ON public.sn_matches;
CREATE POLICY "sn_matches read visible" ON public.sn_matches
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((((SELECT auth.role()) = 'authenticated'::text) AND ((invited_user_id IS NULL) OR ((SELECT auth.uid()) = creator_id) OR ((SELECT auth.uid()) = invited_user_id) OR ((SELECT auth.uid()) = opponent_id))));

DROP POLICY IF EXISTS "sn_matches update participant" ON public.sn_matches;
CREATE POLICY "sn_matches update participant" ON public.sn_matches
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((((SELECT auth.uid()) = creator_id) OR ((SELECT auth.uid()) = opponent_id)));

DROP POLICY IF EXISTS "sn_progress read own" ON public.sn_progress;
CREATE POLICY "sn_progress read own" ON public.sn_progress
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_progress update own" ON public.sn_progress;
CREATE POLICY "sn_progress update own" ON public.sn_progress
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sn_progress write own" ON public.sn_progress;
CREATE POLICY "sn_progress write own" ON public.sn_progress
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "sq_events_insert_self" ON public.sq_events;
CREATE POLICY "sq_events_insert_self" ON public.sq_events
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "sq_events_select_admin" ON public.sq_events;
CREATE POLICY "sq_events_select_admin" ON public.sq_events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_blocks_select_admin" ON public.user_blocks;
CREATE POLICY "user_blocks_select_admin" ON public.user_blocks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_blocks_select_own" ON public.user_blocks;
CREATE POLICY "user_blocks_select_own" ON public.user_blocks
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((blocker = (SELECT auth.uid())));

DROP POLICY IF EXISTS "user_game_access_delete_admin" ON public.user_game_access;
CREATE POLICY "user_game_access_delete_admin" ON public.user_game_access
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_game_access_insert_admin" ON public.user_game_access;
CREATE POLICY "user_game_access_insert_admin" ON public.user_game_access
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_game_access_select_admin" ON public.user_game_access;
CREATE POLICY "user_game_access_select_admin" ON public.user_game_access
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_game_access_select_self" ON public.user_game_access;
CREATE POLICY "user_game_access_select_self" ON public.user_game_access
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "user_game_access_update_admin" ON public.user_game_access;
CREATE POLICY "user_game_access_update_admin" ON public.user_game_access
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_group_members_delete_master" ON public.user_group_members;
CREATE POLICY "user_group_members_delete_master" ON public.user_group_members
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "user_group_members_insert_master" ON public.user_group_members;
CREATE POLICY "user_group_members_insert_master" ON public.user_group_members
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "user_group_members_select_admin" ON public.user_group_members;
CREATE POLICY "user_group_members_select_admin" ON public.user_group_members
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_group_members_select_self" ON public.user_group_members;
CREATE POLICY "user_group_members_select_self" ON public.user_group_members
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "user_group_members_update_master" ON public.user_group_members;
CREATE POLICY "user_group_members_update_master" ON public.user_group_members
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "user_groups_delete_master" ON public.user_groups;
CREATE POLICY "user_groups_delete_master" ON public.user_groups
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "user_groups_insert_master" ON public.user_groups;
CREATE POLICY "user_groups_insert_master" ON public.user_groups
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "user_groups_select_admin" ON public.user_groups;
CREATE POLICY "user_groups_select_admin" ON public.user_groups
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE (admins.user_id = (SELECT auth.uid())))));

DROP POLICY IF EXISTS "user_groups_update_master" ON public.user_groups;
CREATE POLICY "user_groups_update_master" ON public.user_groups
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM admins
  WHERE ((admins.user_id = (SELECT auth.uid())) AND (admins.is_master = true)))));

DROP POLICY IF EXISTS "user_notif_prefs read own" ON public.user_notification_prefs;
CREATE POLICY "user_notif_prefs read own" ON public.user_notification_prefs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((SELECT auth.uid()) = user_id));

DROP POLICY IF EXISTS "user_notif_prefs write own" ON public.user_notification_prefs;
CREATE POLICY "user_notif_prefs write own" ON public.user_notification_prefs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.uid()) = user_id))
  WITH CHECK (((SELECT auth.uid()) = user_id));

COMMIT;