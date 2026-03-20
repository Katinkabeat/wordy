# Push Notifications Setup Guide

One-time Supabase + GitHub setup to activate push notifications in Wordy.

## Prerequisites

- Supabase CLI installed (`npm i -g supabase`)
- Your Supabase project linked (`supabase link --project-ref yyhewndblruwxsrqzart`)

---

## Step 1: Run the database migration

Go to **Supabase Dashboard → SQL Editor → New Query**, paste the contents of `push-subscriptions-migration.sql`, and run it.

## Step 2: Set Edge Function secrets

```bash
supabase secrets set VAPID_PUBLIC_KEY="BCIDqV3c-WrF0HXoeZDJMWCDwr8Ho8L0kOrKdok4LB1cjUpiilEYfiASeqM5kIoKU1J03L-UoS7TJfPZw9f40Ck"
supabase secrets set VAPID_PRIVATE_KEY="<see setup-push.sh or ask Rae>"
supabase secrets set VAPID_SUBJECT="mailto:tracey8008@hotmail.com"
```

> **Never commit the private key to the repo.** It lives only in Supabase secrets and in `setup-push.sh` (which is git-ignored).

## Step 3: Deploy the Edge Function

```bash
supabase functions deploy push-notification --no-verify-jwt
```

## Step 4: Create the database webhook

**Supabase Dashboard → Database → Webhooks → Create:**

| Setting | Value |
|---------|-------|
| Name | `notify-turn-change` |
| Table | `public.games` |
| Events | `UPDATE` |
| Type | Supabase Edge Functions |
| Edge Function | `push-notification` |

## Step 5: Add the GitHub Actions secret

**GitHub → repo Settings → Secrets → Actions → New secret:**

| Secret name | Value |
|-------------|-------|
| `VITE_VAPID_PUBLIC_KEY` | `BCIDqV3c-WrF0HXoeZDJMWCDwr8Ho8L0kOrKdok4LB1cjUpiilEYfiASeqM5kIoKU1J03L-UoS7TJfPZw9f40Ck` |

Then **manually trigger a rebuild** (Actions → Run workflow).

## Step 6: Test it

1. Open Wordy in two browsers (or one incognito)
2. Log in as different users
3. Click **"Enable Notifications"** in the lobby
4. Play a turn from the other browser
5. The first device should get a push notification

---

## Troubleshooting

- **No prompt appears:** Browser may not support push. Check `'PushManager' in window` in console.
- **Permission denied:** User clicked "Block." Must re-allow in browser settings.
- **No notification:** Check Edge Function logs in Supabase Dashboard.
- **PWA not installable:** Check `/wordy/manifest.json` loads in DevTools → Application → Manifest.
