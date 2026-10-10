import { createRefundEffects } from '@care-ecosystem/shared-payments'
import { emailService } from '../../src/lib/emailService.js'
import { flushOutbox } from './outbox.js'

// The payer's email after a refund flips to completed (shared-payments/refundEffects.js). CareHub's reconcile
// cron runs the same shared sweeps CareFind does, so whichever pass completed the refund is the one that
// notifies; CareHub supplies how the email is queued and flushed.
export async function applyRefundResult(supabase, result) {
  const apply = createRefundEffects({
    supabase,
    send: async (message) => {
      await emailService.enqueue(message)
      await flushOutbox()
    },
    logger: { error: (msg, fields) => console.error(`[refundEffects] ${msg}`, fields) },
  })
  return apply(result)
}
