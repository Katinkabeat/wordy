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

export const supabase = createClient(supabaseUrl, supabaseKey)
