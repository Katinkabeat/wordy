-- ============================================================
-- WORDY - Database Webhook for Push Notifications
-- ============================================================
--
-- OPTION A: Supabase Dashboard Webhook (RECOMMENDED)
-- ─────────────────────────────────────────────────────
-- Go to: Supabase Dashboard → Database → Webhooks → Create
--   Name:    notify-turn-change
--   Table:   public.games
--   Events:  UPDATE
--   Type:    Supabase Edge Function
--   Function: push-notification
--   HTTP Headers: (none needed — the function uses service role internally)
--
-- This is the easiest approach — Supabase sends the full old_record
-- and new_record as JSON to the Edge Function on every games UPDATE.
--
-- OPTION B: pg_net extension (if you prefer SQL-only setup)
-- ─────────────────────────────────────────────────────
-- If the Supabase Dashboard webhook UI is not available or you prefer
-- a trigger-based approach, uncomment the SQL below.
-- Requires the pg_net extension to be enabled in your Supabase project.

/*
-- Enable the pg_net extension (HTTP requests from Postgres)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function that fires on games UPDATE and calls the Edge Function
CREATE OR REPLACE FUNCTION public.notify_turn_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only fire if the game is active and the turn actually changed
  IF NEW.status = 'active'
     AND (OLD.current_player_idx IS DISTINCT FROM NEW.current_player_idx) THEN

    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_turn_change ON public.games;
CREATE TRIGGER on_turn_change
  AFTER UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_turn_change();
*/
