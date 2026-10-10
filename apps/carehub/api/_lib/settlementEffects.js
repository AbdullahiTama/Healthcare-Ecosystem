import { createSettlementEffects } from '@care-ecosystem/shared-payments'
import { emailService } from '../../src/lib/emailService.js'
import { flushOutbox } from './outbox.js'

// Post-settlement emails and notices (see shared-payments/effects.js): plan-renewal confirmation to the owner,
// appointment confirmation to the client, and the in-app notice to the business. CareHub supplies how an
// email is queued and flushed.
const logger = { error: (msg, fields) => console.error(`[settlementEffects] ${msg}`, fields) }

export async function runSettlementEffects(supabase, result) {
  const run = createSettlementEffects({
    supabase,
    send: async (message) => {
      await emailService.enqueue(message)
      // The flush must be handed to the platform (waitUntil) or awaited, never left running: the function is frozen as
      // soon as the handler responds, so an un-awaited flush never ran and the confirmation waited for the next cron.
      await flushOutbox()
    },
    logger,
  })
  return run(result)
}
