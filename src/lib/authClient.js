import { createClient } from '@supabase/supabase-js'
import { SB_URL, SB_KEY } from '../config/supabase.js'

if (!SB_URL || !SB_KEY) {
  throw new Error(
    'Supabase credentials missing: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
    'must be set. Copy .env.example to .env and fill in your Supabase project ' +
    'credentials from https://supabase.com/dashboard.'
  )
}

// Separate from lib/realtime.js's client, which deliberately runs with
// persistSession: false — that client only ever listens to a websocket.
// This one carries the actual login session, so it needs to persist and
// auto-refresh like a normal Supabase Auth client.
export const authClient = createClient(SB_URL, SB_KEY)

// Best-effort, fire-and-forget: creates (or, if it already exists, no-ops/resends
// confirmation for) a real Supabase Auth account. Never throws — callers must
// never let this block or fail the primary registration/login flow, since the
// legacy plaintext check is still the source of truth until this succeeds.
export function provisionRealAuthAccount(email, password) {
  authClient.auth.signUp({ email, password }).catch(() => {})
}
