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

// Generic subscription with reconnection.
//
//   spec    { table, event: 'INSERT' | '*', filter?: 'col=eq.value' }
//   onRow   (payload) => void   payload.new / payload.old as Supabase delivers them
//   onStatus 'connecting' | 'live' | 'disconnected'
//
// The socket must carry the user's JWT: postgres_changes is filtered by RLS for
// the connecting role, and an anon socket is never delivered rows from tables
// whose policies admit only authenticated members. So the channel is opened
// only after the session token has been handed to the realtime client.
//
// 'live' means the server confirmed the subscription (SUBSCRIBED), not that setup
// began. If the channel drops it reports 'disconnected' and retries with
// exponential backoff (2 s, 4 s ... capped at 30 s). Rows that arrive while it is
// down are NOT replayed, so on the first 'live' after a 'disconnected' the
// consumer must refetch to catch up; the callers below do.
// If realtime can't be set up at all, this returns a no-op instead of crashing
// the page: the page still works, it just isn't live.
export const RECONNECT_BASE_MS = 2000
export const RECONNECT_MAX_MS = 30000
let channelSeq = 0

export function subscribeChanges(spec, onRow, onStatus) {
  const report = function (status) {
    try { if (onStatus) onStatus(status) } catch (e) {}
  }
  if (!client || !spec || !spec.table) {
    report('disconnected')
    return function () {}
  }

  report('connecting')
  const id = ++channelSeq
  let channel = null
  let stopped = false
  let authSub = null
  let retryTimer = null
  let attempts = 0

  function teardownChannel() {
    const c = channel
    channel = null
    try { if (c) client.removeChannel(c) } catch (e) {}
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempts))
    attempts++
    retryTimer = setTimeout(function () { retryTimer = null; start() }, delay)
  }

  async function start() {
    if (stopped) return
    let token = null
    try {
      const { data } = await authClient.auth.getSession()
      token = data && data.session ? data.session.access_token : null
    } catch (e) {}
    if (stopped) return
    if (!token) {
      // No session: an anon socket would sit "connected" and receive nothing.
      report('disconnected')
      scheduleRetry()
      return
    }
    try {
      client.realtime.setAuth(token)
      const filterOpts = { event: spec.event || 'INSERT', schema: 'public', table: spec.table }
      if (spec.filter) filterOpts.filter = spec.filter
      const mine = client
        .channel('watch-' + spec.table + '-' + (spec.filter || 'all') + '-' + id + '-' + attempts)
        .on('postgres_changes', filterOpts, function (payload) {
          try { if (onRow && payload) onRow(payload) } catch (e) {}
        })
      channel = mine // assigned before subscribing: the callback below compares against it
      mine.subscribe(function (status) {
        if (stopped || channel !== mine) return // a retired channel closing is not news
        if (status === 'SUBSCRIBED') { attempts = 0; report('live') }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          report('disconnected')
          teardownChannel()
          scheduleRetry()
        }
      })
      if (!authSub) {
        // Keep the socket authorised across token refreshes.
        const res = authClient.auth.onAuthStateChange(function (event, session) {
          if (event === 'TOKEN_REFRESHED' && session && session.access_token) {
            try { client.realtime.setAuth(session.access_token) } catch (e) {}
          }
        })
        authSub = res && res.data ? res.data.subscription : null
      }
    } catch (e) {
      report('disconnected')
      scheduleRetry()
    }
  }
  start()

  return function unsubscribe() {
    stopped = true
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    try { if (authSub) authSub.unsubscribe() } catch (e) {}
    teardownChannel()
  }
}

// New rows on a table for one business (the original API, unchanged for callers).
export function watchTable(tableName, businessId, onInsert, onStatus) {
  if (!businessId) {
    if (onStatus) { try { onStatus('disconnected') } catch (e) {} }
    return function () {}
  }
  return subscribeChanges(
    { table: tableName, event: 'INSERT', filter: 'business_id=eq.' + businessId },
    function (payload) { if (onInsert && payload.new) onInsert(payload.new) },
    onStatus,
  )
}
