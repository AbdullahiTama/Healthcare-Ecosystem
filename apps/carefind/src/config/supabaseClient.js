import { createClient } from '@supabase/supabase-js'

// Credentials come from env/config (apps/carefind/.env) so staging and
// production can differ and the key can be rotated without a code deploy.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'CareFind: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
    'Copy apps/carefind/.env.example to apps/carefind/.env and fill in your ' +
    'Supabase project credentials from https://supabase.com/dashboard.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
