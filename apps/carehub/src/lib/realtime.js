import { createClient } from '@supabase/supabase-js'
import { SB_URL, SB_KEY } from '../config/supabase.js'

// This client exists ONLY to listen for live updates over a websocket.
// Every other database call in CareHub still goes through sbFetch in supabase.js.
let client = null
try {
  client = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false },
  })
} catch (e) {
  client = null
}

export const realtime = client

// Listens for new rows on a table for one business.
// If realtime can't connect for any reason, this returns a no-op instead of
// crashing the page — the page still works, it just isn't live.
export function watchTable(tableName, businessId, onInsert) {
  if (!client || !businessId) {
    return function () {}
  }

  let channel = null
  try {
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
      .subscribe()
  } catch (e) {
    return function () {}
  }

  return function unsubscribe() {
    try {
      if (channel) client.removeChannel(channel)
    } catch (e) {}
  }
}
