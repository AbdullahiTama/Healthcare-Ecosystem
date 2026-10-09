import { createSettlementEffects, flushBounded } from '@care-ecosystem/shared-payments'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

// Post-settlement emails and notices (see shared-payments/effects.js). CareFind supplies how an email is
// queued and flushed; the effects themselves are shared with CareHub, so a payment settled by the shared
// webhook gets the same confirmations whichever app it belongs to.
const logger = { error: (msg, fields) => console.error(`[settlementEffects] ${msg}`, fields) }

export async function runSettlementEffects(supabase, result) {
  const run = createSettlementEffects({
    supabase,
    send: async (message) => {
      await enqueueOutbox(message)
      // Awaited (bounded), not fire-and-forget: the function is frozen as soon as the handler responds, so an
      // un-awaited flush never ran and the confirmation waited for the next cron - once a day in production.
      await flushBounded(flushOutbox, { logger })
    },
    logger,
  })
  return run(result)
}
