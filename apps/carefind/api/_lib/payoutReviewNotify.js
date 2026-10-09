import { createPayoutAccountReviewEffects } from '@care-ecosystem/shared-payments'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

// The owner's email after an admin reviews their saved payout account (shared-payments/payoutReviewEffects.js).
// CareFind's admin console reviews accounts owned by CareFind users AND CareHub businesses; the effect picks the
// brand from the owner, and the row is stamped with that app so the drain renders the right template.
export async function notifyPayoutAccountReview(supabase, accountId) {
  const notify = createPayoutAccountReviewEffects({
    supabase,
    send: async (message) => {
      await enqueueOutbox(message)
      flushOutbox().catch((err) => console.error('[payoutReviewNotify] outbox flush error:', err))
    },
    logger: { error: (msg, fields) => console.error(`[payoutReviewNotify] ${msg}`, fields) },
  })
  return notify(accountId)
}
