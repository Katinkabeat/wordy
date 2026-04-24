-- ============================================================
-- push_subscriptions: add `app` column so Wordy and Rungles can
-- each store their own subscription per user.
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================
--
-- Before: UNIQUE(user_id) — only one endpoint per user, so whichever
-- app upserted last overwrote the other. Pushes from one app would
-- be delivered to the other app's service worker.
--
-- After: UNIQUE(user_id, app) — one endpoint per user *per app*.

-- 1. Add the column. Default existing rows to 'wordy' since Wordy
--    created this table and was the only writer until now.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS app TEXT;

UPDATE public.push_subscriptions
  SET app = 'wordy'
  WHERE app IS NULL;

ALTER TABLE public.push_subscriptions
  ALTER COLUMN app SET NOT NULL;

-- 2. Swap the unique constraint.
--    The original UNIQUE(user_id) was created inline on the column,
--    so its constraint name is push_subscriptions_user_id_key.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_key;

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_app_key;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_id_app_key UNIQUE (user_id, app);

-- 3. Replace the per-user index with one that matches the new key.
DROP INDEX IF EXISTS public.idx_push_subs_user;
CREATE INDEX IF NOT EXISTS idx_push_subs_user_app
  ON public.push_subscriptions (user_id, app);
