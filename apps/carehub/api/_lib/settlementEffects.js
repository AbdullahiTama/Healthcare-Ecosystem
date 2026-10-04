import { createSettlementEffects } from '@care-ecosystem/shared-payments'
import { emailService } from '../../src/lib/emailService.js'

// Post-settlement emails and notices (see shared-payments/effects.js): plan-renewal confirmation to the owner,
// appointment confirmation to the client, and the in-app notice to the business. CareHub supplies how an
// email is queued and flushed.
export async function runSettlementEffects(supabase, result) {
  const run = createSettlementEffects({
    supabase,
    send: async (message) => {
      await emailService.enqueue(message)
      emailService.processBatch().catch((err) => console.error('[settlementEffects] outbox flush error:', err))
    },
    logger: { error: (msg, fields) => console.error(`[settlementEffects] ${msg}`, fields) },
  })
  return run(result)
}
