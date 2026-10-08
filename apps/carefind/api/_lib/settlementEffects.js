import { createSettlementEffects } from '@care-ecosystem/shared-payments'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

// Post-settlement emails and notices (see shared-payments/effects.js). CareFind supplies how an email is
// queued and flushed; the effects themselves are shared with CareHub, so a payment settled by the shared
// webhook gets the same confirmations whichever app it belongs to.
export async function runSettlementEffects(supabase, result) {
  const run = createSettlementEffects({
    supabase,
    send: async (message) => {
      await enqueueOutbox(message)
      flushOutbox().catch((err) => console.error('[settlementEffects] outbox flush error:', err))
    },
    logger: { error: (msg, fields) => console.error(`[settlementEffects] ${msg}`, fields) },
  })
  return run(result)
}
