import { createSettlementEffects } from '@care-ecosystem/shared-payments'
import { enqueue as enqueueOutbox } from './emailService.js'
import { flushOutbox } from './outbox.js'

// Post-settlement emails and notices (see shared-payments/effects.js). CareFind supplies how an email is
// queued and flushed; the effects themselves are shared with CareHub, so a payment settled by the shared
// webhook gets the same confirmations whichever app it belongs to.
const logger = { error: (msg, fields) => console.error(`[settlementEffects] ${msg}`, fields) }

export async function runSettlementEffects(supabase, result) {
  const run = createSettlementEffects({
    supabase,
    send: async (message) => {
      await enqueueOutbox(message)
      // The flush must be handed to the platform (waitUntil) or awaited, never left running: the function is frozen as
      // soon as the handler responds, so an un-awaited flush never ran and the confirmation waited for the next cron.
      await flushOutbox()
    },
    logger,
  })
  return run(result)
}
