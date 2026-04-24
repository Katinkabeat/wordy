import { supabase } from './supabase.js';

const GAME = 'wordy';

// Fire-and-forget telemetry. Never awaits from the caller, never throws.
// Writes a row to public.sq_events if a user is signed in; silent no-op otherwise.
// See rae-side-quest/SQ_PHASED_PLAN.md (Phase 2) for the broader plan.
export function logEvent(event, payload = {}) {
  (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) return;
      await supabase.from('sq_events').insert({
        user_id: userId,
        game: GAME,
        event,
        payload,
      });
    } catch {
      // Telemetry must never break gameplay.
    }
  })();
}
