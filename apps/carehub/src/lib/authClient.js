import { createClient } from '@supabase/supabase-js'
import { SB_URL, SB_KEY } from '../config/supabase.js'

if (!SB_URL || !SB_KEY) {
  throw new Error(
    'CareHub: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
    'Copy apps/carehub/.env.example to apps/carehub/.env and fill in your ' +
    'Supabase project credentials from https://supabase.com/dashboard.'
  )
}

// Separate from lib/realtime.js's client, which deliberately runs with
// persistSession: false — that client only ever listens to a websocket.
// This one carries the actual login session, so it needs to persist and
// auto-refresh like a normal Supabase Auth client.
export const authClient = createClient(SB_URL, SB_KEY)

// provisionRealAuthAccount was removed in C2 (20260813): it existed to create
// a Supabase Auth account alongside a plaintext-password business/staff row.
// Registration and staff provisioning now mint confirmed auth users server-side
// (register_business / provision_staff_auth RPCs), so there is no client-side
// account creation left — Login.jsx only ever calls authClient.auth.signInWithPassword.
