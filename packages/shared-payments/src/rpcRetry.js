// Calling the database engines through supabase-js can fail for reasons that have nothing to do with the request: a deadlock the
// database resolved by killing this transaction (40P01), a serialization failure (40001), a lock that stayed taken past the
// function's lock_timeout (55P03), a statement timeout (57014), connection exhaustion or a restart (53300, 57P01, 08xxx), or the
// HTTP hop to PostgREST failing (fetch failed, 502/503/504). In every one of those the engine's transaction ROLLED BACK, and every
// engine function is idempotent (unique ledger keys, row-locked state machines), so asking again is safe and is what the caller
// would otherwise have to do by hand (or wait for a webhook retry or the next sweep).
//
// Only the engines' idempotent entry points use this. A rejection that the engine MEANT (a raised business error, a constraint
// violation) is never retried: the codes below are infrastructure, not business, errors.

const TRANSIENT_CODES = new Set(['40001', '40P01', '55P03', '57014', '53300', '57P01', '08000', '08003', '08006', '08001', '08004'])
const TRANSIENT_MESSAGE = /fetch failed|network|econnreset|etimedout|socket hang up|gateway time-?out|bad gateway|service unavailable|temporarily unavailable|too many connections|deadlock detected|could not serialize/i

/** Infrastructure failure the same call may be repeated after. */
export function isTransientDbError(error) {
  if (!error) return false
  if (TRANSIENT_CODES.has(String(error.code))) return true
  return TRANSIENT_MESSAGE.test(String(error.message || ''))
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * supabase.rpc(name, args) with bounded, jittered retries on transient infrastructure errors.
 * Resolves to the LAST { data, error } (callers keep their own error handling); a thrown network error is converted to an error result
 * after the last attempt rather than thrown, so every caller sees one shape.
 */
export async function rpcWithRetry(supabase, name, args, { attempts = 3, baseDelayMs = 120, sleep = defaultSleep, random = Math.random, logger } = {}) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      last = await supabase.rpc(name, args)
    } catch (err) {
      last = { data: null, error: { message: err?.message || String(err), code: err?.code } }
    }
    if (!last?.error || !isTransientDbError(last.error) || attempt === attempts) return last
    const delay = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.5 + random()))
    logger?.warn?.('db.rpc_retry', { rpc: name, attempt, code: last.error.code, message: String(last.error.message).slice(0, 160), delayMs: delay })
    await sleep(delay)
  }
  return last
}
