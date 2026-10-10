// Flush the email outbox from inside a request, without losing the flush.
//
// A serverless function is frozen the moment it returns its response. `flush().catch(...)` therefore does not run: the email
// stays queued until the next cron (daily today, because the per-minute pg_cron needs Vault secrets that are not set). That was
// the reason purchase confirmations never left; the same fire-and-forget pattern was in about 18 other handlers, including the
// withdrawal one-time codes.
//
// The returned function is meant to be `await`ed where the old code did `flush().catch(...)`, and it NEVER rejects:
//  - on Vercel it hands the flush to `waitUntil`, so the response is not delayed and the platform keeps the invocation alive
//    until the flush settles;
//  - anywhere else (tests, local dev, a platform without waitUntil) it waits for the flush, but only for `timeoutMs`, so a slow
//    provider cannot hold the response hostage. A flush that misses the deadline is picked up by the next drain: the row was
//    queued before this was called.
//
// `waitUntil` is INJECTED (from '@vercel/functions' in each app). This package cannot resolve its own dependencies on Vercel
// (it is deployed without a node_modules of its own), so it must not import it.

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

/**
 * Whether the platform will keep this invocation alive for work handed to `waitUntil`. Vercel's `waitUntil` is a silent no-op
 * outside a request context, and handing it the work there would lose the flush, so this is checked first. It reads the same
 * global `@vercel/functions` reads; if that ever changes this returns false and the caller falls back to a bounded wait, which
 * is slower but still correct.
 */
export function canRunInBackground(globalObject = globalThis) {
  try {
    return typeof globalObject[REQUEST_CONTEXT]?.get?.()?.waitUntil === 'function'
  } catch {
    return false
  }
}

/**
 * @param {object} deps
 * @param {() => Promise<unknown>} deps.flush        e.g. () => emailService.processBatch()
 * @param {(promise: Promise<unknown>) => void} [deps.waitUntil]   from '@vercel/functions'
 * @param {() => Promise<(promise: Promise<unknown>) => void>} [deps.loadWaitUntil]  lazy alternative to `waitUntil`: called once, and
 *        only when the platform supports background work, so a module that cannot afford a load-time failure (CareFind's router
 *        imports everything, so a throw at import takes down every route) never imports '@vercel/functions' off Vercel.
 * @param {{error: Function}} [deps.logger]
 * @param {number} [deps.timeoutMs]                   bound for the in-request wait (default 4000)
 * @param {() => boolean} [deps.isBackgroundSupported]  override for tests
 * @returns {() => Promise<void>}
 */
export function createOutboxFlusher({ flush, waitUntil: givenWaitUntil, loadWaitUntil, logger = { error() {} }, timeoutMs = 4000, isBackgroundSupported = canRunInBackground } = {}) {
  if (typeof flush !== 'function') throw new TypeError('createOutboxFlusher needs a flush function')
  let loaded // the lazily loaded waitUntil, kept after the first successful load

  return async function flushOutbox() {
    // Never rejects: a failed flush is logged, and the queued row is retried by the next drain.
    const work = Promise.resolve()
      .then(flush)
      .then(() => undefined, (err) => { logger.error('outbox.flush.failed', { message: err?.message }) })

    if (isBackgroundSupported()) {
      try {
        let waitUntil = givenWaitUntil || loaded
        if (typeof waitUntil !== 'function' && typeof loadWaitUntil === 'function') waitUntil = loaded = await loadWaitUntil()
        if (typeof waitUntil === 'function') {
          waitUntil(work)
          return
        }
      } catch (err) {
        logger.error('outbox.flush.waituntil_failed', { message: err?.message })
        // fall through: wait for it here instead
      }
    }

    let timer
    try {
      await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) })])
    } finally {
      clearTimeout(timer)
    }
  }
}
