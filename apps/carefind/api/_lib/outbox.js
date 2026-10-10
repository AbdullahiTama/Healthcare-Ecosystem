import { processBatch } from './emailService.js'

// How a CareFind handler flushes the email outbox from inside a request: `await flushOutbox()` where the code used to say
// `flushOutbox().catch(...)`. A serverless function is frozen the moment it responds, so the un-awaited flush never ran and the
// email waited for the next cron (daily in production). The behaviour - hand it to waitUntil on Vercel, wait a bounded time
// anywhere else, never reject - lives in packages/shared-email/src/outboxFlush.js; this file only supplies CareFind's flush.
//
// Both packages are imported lazily, like emailService.js does: the router imports every handler, so a failure to load either
// at import time would take every route down with it instead of costing one email.
const logger = { error: (msg, fields) => console.error(`[outbox] ${msg}`, fields) }

let flusher
async function flusherInstance() {
  if (!flusher) {
    // The subpath, not the package root: the flusher has no dependencies of its own, and the root pulls in the whole mail stack.
    const { createOutboxFlusher } = await import('@care-ecosystem/shared-email/outboxFlush')
    flusher = createOutboxFlusher({
      flush: () => processBatch(),
      loadWaitUntil: async () => (await import('@vercel/functions')).waitUntil,
      logger,
    })
  }
  return flusher
}

/** Never rejects: a flush that cannot run is logged, and the queued row is sent by the next drain. */
export async function flushOutbox() {
  try {
    await (await flusherInstance())()
  } catch (err) {
    logger.error('outbox.flush.unavailable', { message: err?.message })
  }
}
