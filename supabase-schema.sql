-- ============================================================
-- WORDY - Supabase Database Schema
-- Run this entire file in: Supabase → SQL Editor → New Query
-- ============================================================

-- ── 1. PROFILES ──────────────────────────────────────────────
-- Extends Supabase's built-in auth.users table with a username
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT    UNIQUE NOT NULL,
  avatar_hue  INT     DEFAULT 270,   -- HSL hue for avatar colour (270 = purple)
  tile_hue    INT     DEFAULT 270,   -- HSL hue for tile colour (270 = purple)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create a profile row whenever someone signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 2. GAMES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.games (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status              TEXT        NOT NULL DEFAULT 'waiting'
                                  CHECK (status IN ('waiting','active','finished')),
  max_players         INT         NOT NULL DEFAULT 2,
  current_player_idx  INT         NOT NULL DEFAULT 0,
  board               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  tile_bag            TEXT[]      NOT NULL DEFAULT '{}',
  consecutive_passes  INT         NOT NULL DEFAULT 0,
  board_layout_version INT        NOT NULL DEFAULT 1,  -- 1 = Scrabble layout; new games use the current version
  created_by          UUID        REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  finished_at         TIMESTAMPTZ
);

-- ── 3. GAME PLAYERS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_players (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID    NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  player_index  INT     NOT NULL,
  rack          TEXT[]  NOT NULL DEFAULT '{}',
  score         INT     NOT NULL DEFAULT 0,
  is_winner     BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_id, user_id),
  UNIQUE (game_id, player_index)
);

-- ── 4. GAME MOVES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_moves (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID    NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES auth.users(id),
  move_type     TEXT    NOT NULL CHECK (move_type IN ('place','exchange','pass')),
  tiles_placed  JSONB,          -- [{row, col, letter, isBlank}]
  words_formed  TEXT[],
  score         INT     NOT NULL DEFAULT 0,
  rack_after    TEXT[],         -- player's rack after the move (for replay)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. PLAYER STATS ──────────────────────────────────────────
-- Stores cumulative win/loss data per pair of players
CREATE TABLE IF NOT EXISTS public.player_matchups (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID  NOT NULL REFERENCES auth.users(id),
  opponent_id  UUID  NOT NULL REFERENCES auth.users(id),
  wins         INT   NOT NULL DEFAULT 0,
  losses       INT   NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id, opponent_id)
);

-- Function called when a game finishes to update matchup stats
CREATE OR REPLACE FUNCTION public.record_game_result(p_game_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  winner_id   UUID;
  player_rec  RECORD;
  opp_rec     RECORD;
BEGIN
  -- Find the winner
  SELECT user_id INTO winner_id
  FROM public.game_players
  WHERE game_id = p_game_id AND is_winner = TRUE
  LIMIT 1;

  IF winner_id IS NULL THEN RETURN; END IF;

  -- For every player in the game, update their matchup vs every other player
  FOR player_rec IN
    SELECT user_id FROM public.game_players WHERE game_id = p_game_id
  LOOP
    FOR opp_rec IN
      SELECT user_id FROM public.game_players
      WHERE game_id = p_game_id AND user_id != player_rec.user_id
    LOOP
      INSERT INTO public.player_matchups (player_id, opponent_id, wins, losses, updated_at)
      VALUES (
        player_rec.user_id,
        opp_rec.user_id,
        CASE WHEN player_rec.user_id = winner_id THEN 1 ELSE 0 END,
        CASE WHEN player_rec.user_id != winner_id THEN 1 ELSE 0 END,
        NOW()
      )
      ON CONFLICT (player_id, opponent_id) DO UPDATE SET
        wins       = player_matchups.wins   + EXCLUDED.wins,
        losses     = player_matchups.losses + EXCLUDED.losses,
        updated_at = NOW();
    END LOOP;
  END LOOP;
END;
$$;

-- ── 6. ROW LEVEL SECURITY ────────────────────────────────────
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_moves       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_matchups  ENABLE ROW LEVEL SECURITY;

-- Drop policies first so re-running this script is always safe
DROP POLICY IF EXISTS "profiles: read all"   ON public.profiles;
DROP POLICY IF EXISTS "profiles: update own" ON public.profiles;
DROP POLICY IF EXISTS "games: read all"      ON public.games;
DROP POLICY IF EXISTS "games: insert auth"   ON public.games;
DROP POLICY IF EXISTS "games: update player" ON public.games;
DROP POLICY IF EXISTS "gp: read all"         ON public.game_players;
DROP POLICY IF EXISTS "gp: insert own"       ON public.game_players;
DROP POLICY IF EXISTS "gp: update own"       ON public.game_players;
DROP POLICY IF EXISTS "moves: read game"     ON public.game_moves;
DROP POLICY IF EXISTS "moves: insert own"    ON public.game_moves;
DROP POLICY IF EXISTS "matchups: read own"   ON public.player_matchups;
DROP POLICY IF EXISTS "matchups: upsert"     ON public.player_matchups;

-- profiles: anyone logged in can read profiles; only owner can update theirs
CREATE POLICY "profiles: read all"    ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "profiles: update own"  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- games: anyone logged in can see all games; only participants can update
CREATE POLICY "games: read all"       ON public.games FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "games: insert auth"    ON public.games FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "games: update player"  ON public.games FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.game_players WHERE game_id = id AND user_id = auth.uid())
);

-- game_players: readable by all logged-in users; insert if you are joining
CREATE POLICY "gp: read all"          ON public.game_players FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "gp: insert own"        ON public.game_players FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gp: update own"        ON public.game_players FOR UPDATE USING (auth.uid() = user_id);

-- game_moves: readable by game participants; insert own moves only
CREATE POLICY "moves: read game"      ON public.game_moves FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.game_players WHERE game_id = game_moves.game_id AND user_id = auth.uid())
);
CREATE POLICY "moves: insert own"     ON public.game_moves FOR INSERT WITH CHECK (auth.uid() = user_id);

-- player_matchups: only your own stats
CREATE POLICY "matchups: read own"    ON public.player_matchups FOR SELECT USING (auth.uid() = player_id);
CREATE POLICY "matchups: upsert"      ON public.player_matchups FOR ALL  USING (TRUE); -- managed by function

-- ── 7. REALTIME ──────────────────────────────────────────────
-- Enable real-time updates for these tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_moves;

-- ── 8. ADMIN SYSTEM ──────────────────────────────────────────
-- See admin-migration.sql for full setup instructions.
-- Run admin-migration.sql AFTER this schema to set up:
--   • public.admins table (user_id, permissions[], is_master, added_by)
--   • RLS policies (read own row; master can read/write all)
--   • admin_close_game(UUID) — SECURITY DEFINER function to close any game
--   • admin_list_profiles()  — returns all profiles for admin user picker
--   • admin_list_open_games() — returns all waiting/active games for admin panel
--   • Seeds tracey8008@hotmail.com as master admin with close_games permission
