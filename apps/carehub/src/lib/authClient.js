import { createClient } from '@supabase/supabase-js'
import { SB_URL, SB_KEY } from '../config/supabase.js'

// Separate from lib/realtime.js's client, which deliberately runs with
// persistSession: false — that client only ever listens to a websocket.
// This one carries the actual login session, so it needs to persist and
// auto-refresh like a normal Supabase Auth client.
export const authClient = createClient(SB_URL, SB_KEY)

// Best-effort: creates (or, if it already exists, no-ops/resends confirmation
// for) a real Supabase Auth account AND tries to establish a session for it.
// Returns the session (or null) — never throws, so callers can always fall
// back to the legacy plaintext check as the source of truth.
//
// Why the extra signInWithPassword: signUp() only returns a session when
// email confirmation is disabled. This project requires confirmation
// (confirmation_sent_at was observed on live sign-ups), so a provisioned
// account alone never produced a session — and sessionless requests fall
// back to the anon key, where RLS (phase2_rls_pilot.sql) rejects every
// write (the "Could not save patient" bug). The backfill migration
// (sql/20260802_backfill_confirmed_auth_users.sql) pre-creates confirmed
// auth users for all legacy businesses/staff rows, so this sign-in succeeds
// for migrated accounts and upgrades them to a real session on next login.
export async function provisionRealAuthAccount(email, password) {
  try {
    const { data, error } = await authClient.auth.signUp({ email, password })
    if (data?.session) return data.session
    const res = await authClient.auth.signInWithPassword({ email, password })
    return res.data?.session || null
  } catch (e) {
    return null
  }
}
