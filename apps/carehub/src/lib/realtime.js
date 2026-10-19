import { createClient } from '@supabase/supabase-js'
import { SB_URL, SB_KEY } from '../config/supabase.js'
import { authClient } from './authClient.js'

// This client exists ONLY to listen for live updates over a websocket.
// Every other database call in CareHub still goes through sbFetch in supabase.js.
// It deliberately runs with persistSession: false — it must never hold or
// overwrite the login session. A distinct storageKey keeps supabase-js from
// raising its "Multiple GoTrueClient instances detected" warning: two clients
// (this one and lib/authClient.js's) would otherwise share the default
// `sb-<project-ref>-auth-token` key in the same browser context.
let client = null
try {
  client = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, storageKey: 'carehub-realtime-ignored' },
  })
} catch (e) {
  client = null
}

export const realtime = client

// Listens for new rows on a table for one business.
// If realtime can't connect for any reason, this returns a no-op instead of
// crashing the page — the page still works, it just isn't live.
//
// The socket must carry the user's JWT: postgres_changes is filtered by RLS for
// the connecting role, and an anon socket is never delivered rows from tables
// whose policies admit only authenticated members. So the channel is opened
// only after the session token has been handed to the realtime client.
//
// `onStatus` receives 'connecting' | 'live' | 'disconnected'. 'live' means the
// server confirmed the subscription (SUBSCRIBED), not that setup began.
export function watchTable(tableName, businessId, onInsert, onStatus) {
  const report = function (status) {
    try { if (onStatus) onStatus(status) } catch (e) {}
  }
  if (!client || !businessId) {
    report('disconnected')
    return function () {}
  }

  report('connecting')
  let channel = null
  let stopped = false
  let authSub = null

  async function start() {
    let token = null
    try {
      const { data } = await authClient.auth.getSession()
      token = data && data.session ? data.session.access_token : null
    } catch (e) {}
    if (stopped) return
    if (!token) {
      // No session: an anon socket would sit "connected" and receive nothing.
      report('disconnected')
      return
    }
    try {
      client.realtime.setAuth(token)
      channel = client
        .channel('watch-' + tableName + '-' + businessId)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: tableName,
            filter: 'business_id=eq.' + businessId,
          },
          function (payload) {
            try {
              if (onInsert && payload && payload.new) onInsert(payload.new)
            } catch (e) {}
          }
        )
        .subscribe(function (status) {
          if (stopped) return
          if (status === 'SUBSCRIBED') report('live')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') report('disconnected')
        })
      // Keep the socket authorised across token refreshes.
      const res = authClient.auth.onAuthStateChange(function (event, session) {
        if (event === 'TOKEN_REFRESHED' && session && session.access_token) {
          try { client.realtime.setAuth(session.access_token) } catch (e) {}
        }
      })
      authSub = res && res.data ? res.data.subscription : null
    } catch (e) {
      report('disconnected')
    }
  }
  start()

  return function unsubscribe() {
    stopped = true
    try { if (authSub) authSub.unsubscribe() } catch (e) {}
    try { if (channel) client.removeChannel(channel) } catch (e) {}
  }
}
