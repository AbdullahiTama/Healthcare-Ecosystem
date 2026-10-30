import { authClient } from './authClient.js'

// Live updates over the session client's websocket (see lib/authClient.js for
// why it is not a separate client). Every other database call in CareHub
// still goes through sbFetch in services/supabase.js.
const client = authClient

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
