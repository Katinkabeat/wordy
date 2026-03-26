-- ============================================================
-- WORDY - Nudge Feature Migration
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================

-- 1. Add columns to track turn timing and nudge cooldown
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS last_nudged_at  TIMESTAMPTZ;

-- 2. Auto-set turn_started_at whenever the turn changes or the game starts.
--    This is a BEFORE trigger so it modifies the row before it's written.
CREATE OR REPLACE FUNCTION public.set_turn_started_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.turn_started_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_turn_start_timestamp ON public.games;
CREATE TRIGGER on_turn_start_timestamp
BEFORE UPDATE ON public.games
FOR EACH ROW
WHEN (
  (OLD.current_player_idx IS DISTINCT FROM NEW.current_player_idx) OR
  (OLD.status = 'waiting' AND NEW.status = 'active')
)
EXECUTE FUNCTION public.set_turn_started_at();

-- 3. Backfill turn_started_at for existing active games using the most recent move time.
--    Games with no moves yet get their created_at as fallback.
UPDATE public.games g
SET turn_started_at = COALESCE(
  (SELECT MAX(created_at) FROM public.game_moves WHERE game_id = g.id),
  g.created_at
)
WHERE g.status = 'active' AND g.turn_started_at IS NULL;
