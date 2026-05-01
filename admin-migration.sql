-- ============================================================
-- WORDY - Admin System Migration
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================

-- ── 0. CLOSED-BY-ADMIN FLAG ON GAMES ──────────────────────────
-- Marks a game that an admin closed via admin_close_game so the
-- lobby + game-end UI can render "🛑 Game closed by admin" without
-- attributing a winner. Idempotent.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS closed_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1. ADMINS TABLE ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admins (
  user_id     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  permissions TEXT[]      NOT NULL DEFAULT '{}',
  is_master   BOOLEAN     NOT NULL DEFAULT FALSE,
  added_by    UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. HELPER FUNCTION (avoids recursive RLS) ─────────────────
-- SECURITY DEFINER means this runs as the DB owner and bypasses
-- RLS, so the policies below can call it without infinite loops.
CREATE OR REPLACE FUNCTION public.is_master_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = auth.uid() AND is_master = TRUE
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_master_admin() TO authenticated;

-- ── 3. ROW LEVEL SECURITY ─────────────────────────────────────
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies so re-running is safe
DROP POLICY IF EXISTS "admins: read own"      ON public.admins;
DROP POLICY IF EXISTS "admins: master select" ON public.admins;
DROP POLICY IF EXISTS "admins: master insert" ON public.admins;
DROP POLICY IF EXISTS "admins: master update" ON public.admins;
DROP POLICY IF EXISTS "admins: master delete" ON public.admins;

-- Any logged-in user can read their OWN admin row
-- (so the frontend can check "am I an admin?" without needing elevated access)
CREATE POLICY "admins: read own"
  ON public.admins FOR SELECT
  USING (auth.uid() = user_id);

-- Master admin can read ALL admin rows
-- (uses the SECURITY DEFINER helper to avoid recursive policy evaluation)
CREATE POLICY "admins: master select"
  ON public.admins FOR SELECT
  USING (public.is_master_admin());

-- Only master admin can add new admins
CREATE POLICY "admins: master insert"
  ON public.admins FOR INSERT
  WITH CHECK (public.is_master_admin());

-- Only master admin can change permissions
CREATE POLICY "admins: master update"
  ON public.admins FOR UPDATE
  USING (public.is_master_admin());

-- Only master admin can revoke admin access
CREATE POLICY "admins: master delete"
  ON public.admins FOR DELETE
  USING (public.is_master_admin());

-- ── 4. SEED RAE AS MASTER ADMIN ──────────────────────────────
-- Looks up Rae's user ID by email and inserts her as master admin.
-- ON CONFLICT means it's safe to re-run this script.
INSERT INTO public.admins (user_id, permissions, is_master, added_by)
SELECT
  id,
  ARRAY['close_games'],
  TRUE,
  id
FROM auth.users
WHERE email = 'tracey8008@hotmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── 5. ADMIN CLOSE GAME FUNCTION ──────────────────────────────
-- SECURITY DEFINER lets this function update any game regardless
-- of whether the admin is a player in that game (bypasses RLS).
-- The function itself enforces the permission check.
--
-- Sets games.closed_by_admin = TRUE so the lobby + game-end UI can
-- render "🛑 Game closed by admin" with no winner attribution. The
-- `closed_by_admin` column lives on public.games (NOT NULL DEFAULT FALSE).
CREATE OR REPLACE FUNCTION public.admin_close_game(p_game_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verify the caller has the close_games permission
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = auth.uid()
      AND 'close_games' = ANY(permissions)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: you do not have the close_games permission';
  END IF;

  -- Close the game and flag it as admin-closed so no winner is attributed.
  UPDATE public.games
  SET status = 'finished', finished_at = NOW(), closed_by_admin = TRUE
  WHERE id = p_game_id
    AND status IN ('waiting', 'active');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found or is already closed';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_close_game(UUID) TO authenticated;

-- ── 6. ADMIN LIST ALL USERS FUNCTION ──────────────────────────
-- Master admin needs to see all profiles to pick who to promote.
-- This SECURITY DEFINER function returns all profiles safely.
CREATE OR REPLACE FUNCTION public.admin_list_profiles()
RETURNS TABLE (id UUID, username TEXT) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT p.id, p.username
  FROM public.profiles p
  ORDER BY p.username ASC
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_profiles() TO authenticated;

-- ── 7. ADMIN LIST ALL GAMES FUNCTION ──────────────────────────
-- Admins need to see ALL active/waiting games (including ones they
-- are not in, which would normally be filtered by RLS on game_moves).
-- Games are already readable by all logged-in users per existing policy,
-- so this is just a convenience function for the admin panel.
CREATE OR REPLACE FUNCTION public.admin_list_open_games()
RETURNS TABLE (
  id          UUID,
  status      TEXT,
  max_players INT,
  created_at  TIMESTAMPTZ,
  player_names TEXT[]
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    g.id,
    g.status,
    g.max_players,
    g.created_at,
    ARRAY_AGG(pr.username ORDER BY gp.player_index) AS player_names
  FROM public.games g
  LEFT JOIN public.game_players gp ON gp.game_id = g.id
  LEFT JOIN public.profiles pr     ON pr.id = gp.user_id
  WHERE g.status IN ('waiting', 'active')
  GROUP BY g.id, g.status, g.max_players, g.created_at
  ORDER BY g.created_at ASC
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_open_games() TO authenticated;
