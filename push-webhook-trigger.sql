-- ============================================================
-- WORDY - Database Trigger for Push Notifications
-- ============================================================
--
-- Calls the Push-Notification Edge Function via pg_net whenever
-- a turn changes in an active game.
--
-- Auth approach: uses the project's anon key (which is public —
-- it's already embedded in the frontend JavaScript bundle).
-- The Edge Function only needs a valid JWT to pass verification;
-- it creates its own service_role client internally to query
-- game_players and push_subscriptions.
--
-- NOTE: current_setting('supabase.service_role_key') returns NULL
-- in a trigger context, and supabase_functions.http_request() has
-- the same issue. Hardcoding the anon key is the reliable approach.

CREATE OR REPLACE FUNCTION public.notify_turn_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Push notification trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_turn_change ON public.games;
CREATE TRIGGER on_turn_change
AFTER UPDATE ON public.games
FOR EACH ROW
WHEN (NEW.status = 'active' AND OLD.current_player_idx IS DISTINCT FROM NEW.current_player_idx)
EXECUTE FUNCTION public.notify_turn_change();
