import { createClient } from '@supabase/supabase-js'
import { SB_URL, SB_KEY } from '../config/supabase.js'

if (!SB_URL || !SB_KEY) {
  throw new Error(
    'CareHub: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
    'Copy apps/carehub/.env.example to apps/carehub/.env and fill in your ' +
    'Supabase project credentials from https://supabase.com/dashboard.'
  )
}

// The one Supabase client in CareHub. It carries the login session (persisted,
// auto-refreshed) and also owns the realtime websocket (lib/realtime.js), so
// the socket joins channels as the signed-in user and supabase-js hands it
// every renewed token. lib/realtime.js used to run its own anon client, which
// RLS on staff_notifications / field_activities left with no events at all.
//
// realtime.worker runs the socket heartbeat in a Web Worker. Browsers throttle
// timers in background tabs to about once a minute, which made the server
// drop the socket of a tab left in the background; a worker's timers keep
// running. realtime-js refuses to start without Worker support (some older
// in-app browsers, the jsdom test environment), so it is only asked for
// where it exists.
export const authClient = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { worker: typeof Worker !== 'undefined' },
})

// provisionRealAuthAccount was removed in C2 (20260813): it existed to create
// a Supabase Auth account alongside a plaintext-password business/staff row.
// Registration and staff provisioning now mint confirmed auth users server-side
// (register_business / provision_staff_auth RPCs), so there is no client-side
// account creation left — Login.jsx only ever calls authClient.auth.signInWithPassword.
