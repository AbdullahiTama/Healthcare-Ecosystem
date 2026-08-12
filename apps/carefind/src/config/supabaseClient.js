import { createClient } from '@supabase/supabase-js'

// Credentials come from env/config (apps/carefind/.env) so staging and
// production can differ and the key can be rotated without a code deploy.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
