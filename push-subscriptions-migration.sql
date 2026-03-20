-- ============================================================
-- WORDY - Push Notifications Migration
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================

-- ── 1. PUSH SUBSCRIPTIONS TABLE ─────────────────────────────
-- Stores each user's Web Push subscription so the Edge Function
-- can send them "your turn" notifications.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  endpoint    TEXT         NOT NULL,
  keys_p256dh TEXT         NOT NULL,
  keys_auth   TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ── 2. ROW LEVEL SECURITY ───────────────────────────────────
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs: read own"   ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs: insert own"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs: update own"  ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subs: delete own"  ON public.push_subscriptions;

-- Users can only manage their own push subscription
CREATE POLICY "push_subs: read own"   ON public.push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "push_subs: insert own" ON public.push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "push_subs: update own" ON public.push_subscriptions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "push_subs: delete own" ON public.push_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- ── 3. SERVICE ROLE ACCESS ──────────────────────────────────
-- The Edge Function uses the service_role key to read subscriptions
-- for ANY user (so it can look up the next player's subscription).
-- The service_role key bypasses RLS by default, so no extra policy needed.

-- ── 4. INDEX ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions (user_id);
