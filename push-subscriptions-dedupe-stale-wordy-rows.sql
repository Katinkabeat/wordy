-- ============================================================
-- One-shot cleanup: delete `wordy` rows whose endpoint is actually
-- a Rungles SW endpoint (same user also has a `rungles` row with
-- the identical endpoint). These are leftovers from before the
-- `app` column existed, when Rungles had overwritten the shared
-- row. The migration defaulted them to app='wordy' but the
-- endpoint still points at /rungles/sw.js.
--
-- After running this, affected users will silently skip Wordy
-- pushes until they next open Wordy's lobby, at which point
-- resyncPushSubscription will recreate the row with the real
-- Wordy SW endpoint.
-- ============================================================

-- Preview first: show what's about to be deleted.
SELECT w.user_id, right(w.endpoint, 40) AS endpoint_tail, w.updated_at
FROM push_subscriptions w
JOIN push_subscriptions r
  ON r.user_id = w.user_id
 AND r.app = 'rungles'
 AND r.endpoint = w.endpoint
WHERE w.app = 'wordy';

-- Delete them.
DELETE FROM push_subscriptions w
USING push_subscriptions r
WHERE w.app = 'wordy'
  AND r.app = 'rungles'
  AND r.user_id = w.user_id
  AND r.endpoint = w.endpoint;
