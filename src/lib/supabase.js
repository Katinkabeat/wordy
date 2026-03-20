import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '⚠️  Missing Supabase credentials.\n' +
    'Copy .env.example → .env and fill in your project URL and anon key.\n' +
    'Get them from: Supabase → Your Project → Settings → API'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Use localStorage instead of the default navigator.locks-based storage.
    // navigator.locks can get orphaned (tab crash, SW conflict, etc.) and
    // cause getSession() to hang forever — which shows an infinite
    // "Loading Wordy…" spinner.  localStorage is simpler and reliable
    // for a single-tab PWA like Wordy.
    lock: { enabled: false },
    storageKey: 'sb-yyhewndblruwxsrqzart-auth-token',
  },
})
