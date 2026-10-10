import { waitUntil } from '@vercel/functions'
// The subpath, not the package root: the flusher has no dependencies of its own, and the root pulls in the whole mail stack.
import { createOutboxFlusher } from '@care-ecosystem/shared-email/outboxFlush'
import { emailService } from '../../src/lib/emailService.js'

// How a CareHub handler flushes the email outbox from inside a request: `await flushOutbox()` where the code used to say
// `emailService.processBatch().catch(...)`. A serverless function is frozen the moment it responds, so the un-awaited flush never
// ran and the email waited for the next cron (daily in production). The behaviour - hand it to waitUntil on Vercel, wait a
// bounded time anywhere else, never reject - lives in packages/shared-email/src/outboxFlush.js; this file only supplies CareHub's
// flush and its waitUntil (the shared package cannot resolve '@vercel/functions' itself).
const logger = { error: (msg, fields) => console.error(`[outbox] ${msg}`, fields) }

/** Never rejects: a flush that fails is logged, and the queued row is sent by the next drain. */
export const flushOutbox = createOutboxFlusher({
  flush: () => emailService.processBatch(),
  waitUntil,
  logger,
})
