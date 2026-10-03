import { createClient } from '@supabase/supabase-js'

// Lazy service-role client.
//
// The api/router.js bundles every handler into one serverless function with
// static imports, so any module-scope throw takes down every route. A handler
// that called createClient() at import time therefore coupled the whole API's
// availability to SUPABASE_URL being present at load: a missing or malformed
// value produced FUNCTION_INVOCATION_FAILED on all 15 routes instead of one.
//
// Nothing here touches process.env or the network until the first actual
// property access, so importing a handler is always safe. A genuinely missing
// config still raises, just on the request that needed the database, where the
// cron handler can turn it into a 500 with a clear message.

let _client = null

export function getSupabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    }
    _client = createClient(url, key)
  }
  return _client
}

// Proxy so call sites read `supabase.from(...)` unchanged. Methods are bound to
// the real client: supabase-js stores per-client state on `this`, and an
// unbound call would receive the proxy as `this` and silently misbehave.
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getSupabase()
      const value = Reflect.get(client, prop)
      return typeof value === 'function' ? value.bind(client) : value
    },
  }
)

export default supabase
