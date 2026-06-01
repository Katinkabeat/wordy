-- ============================================================
-- WORDY — invite-expiry baseline (card c151)
--
-- Brings Wordy onto the SQ invite-expiry baseline (the policy shipped
-- for Yahdle in c150 and baked into sq-game-starter in c152):
--   • Friend-invite window 1 day → 3 days (open games stay 7 days).
--   • At expiry, NEVER silently drop a game people were waiting in:
--       - 2+ players joined → auto-start short-handed (UNCHANGED — Wordy
--         already does this; turn rotation is client-side over the joined
--         players, so it's already correct for a partial table). The
--         no-show invitees stay in invited_user_ids and render as greyed
--         ✗ pills in the score panel.
--       - fewer than 2 (only the creator) → CLOSE, don't cancel: set
--         status='finished' + close_reason='no_other_players'. This files
--         it under Completed with an "invite expired" blurb instead of
--         vanishing (the old 'cancelled' status was never surfaced). We
--         do NOT call finish_game(), so it records NO matchup stats, and
--         setting a 'waiting' game straight to 'finished' fires none of
--         Wordy's turn/bot push triggers (they require status='active').
--         The lone creator gets one 'game_closed' push.
--
-- Reuses the existing close_reason column (from admin-close-reason-
-- migration.sql); closed_by_admin stays false so the UI can tell an
-- invite-expiry close apart from an admin close.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. Expiry window: friend invites 1 day → 3 days ──────────
CREATE OR REPLACE FUNCTION public.wordy_set_game_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    IF NEW.invited_user_ids IS NOT NULL AND cardinality(NEW.invited_user_ids) > 0 THEN
      NEW.expires_at := NEW.created_at + INTERVAL '3 days';
    ELSE
      NEW.expires_at := NEW.created_at + INTERVAL '7 days';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Sweep: auto-start short-handed, or CLOSE (not cancel) ──
-- Was: <2 joined → status='cancelled' (silently never shown again).
-- Now: <2 joined → status='finished' + close_reason='no_other_players'
-- + one game_closed push to the creator.
CREATE OR REPLACE FUNCTION public.wordy_auto_start_or_cancel_stale()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_game RECORD;
  v_count int := 0;
  v_player_count int;
  v_first_player int;
BEGIN
  FOR v_game IN
    SELECT id, max_players, created_by FROM public.games
    WHERE status = 'waiting'
      AND expires_at IS NOT NULL
      AND expires_at < now()
  LOOP
    SELECT count(*) INTO v_player_count FROM public.game_players WHERE game_id = v_game.id;

    IF v_player_count >= 2 THEN
      -- Playable short-handed. Rotation is client-side over the joined
      -- players, so a partial table is fine; the no-show invitees stay in
      -- invited_user_ids for the greyed ✗ pills.
      v_first_player := floor(random() * v_player_count)::int;
      UPDATE public.games
      SET status = 'active',
          current_player_idx = v_first_player
      WHERE id = v_game.id;
    ELSE
      -- Only the creator — unplayable. Close with a reason instead of
      -- cancelling into the void. No finish_game() → no stats. No push
      -- trigger fires (those require status='active').
      UPDATE public.games
      SET status = 'finished',
          close_reason = 'no_other_players',
          finished_at = now()
      WHERE id = v_game.id;

      -- One push to the lone creator (the only notification in this flow).
      BEGIN
        PERFORM net.http_post(
          url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
          ),
          body := jsonb_build_object(
            'type', 'game_closed',
            'record', jsonb_build_object(
              'id', v_game.id,
              'created_by', v_game.created_by,
              'close_reason', 'no_other_players'
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Wordy game_closed push failed: %', SQLERRM;
      END;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wordy_auto_start_or_cancel_stale() TO authenticated;

COMMIT;
