import { createRefundEffects } from '@care-ecosystem/shared-payments'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

// The payer's email after a refund flips to completed (shared-payments/refundEffects.js). Whichever seam
// completed the refund - the cancel call, the webhook, or a cron pass - is the one that notifies; the effect
// stamps the row with the app that owns the original charge, so the drain renders that app's brand.
export async function applyRefundResult(supabase, result) {
  const apply = createRefundEffects({
    supabase,
    send: async (message) => {
      await enqueueOutbox(message)
      flushOutbox().catch((err) => console.error('[refundEffects] outbox flush error:', err))
    },
    logger: { error: (msg, fields) => console.error(`[refundEffects] ${msg}`, fields) },
  })
  return apply(result)
}
