import { createBusinessWithdrawalEffects } from '@care-ecosystem/shared-payments'
import { enqueue as enqueueOutbox } from './emailService.js'
import { flushOutbox } from './outbox.js'

// The owner's email after a CareHub business withdrawal settles (shared-payments/businessWithdrawalEffects.js).
// CareFind's webhook endpoint serves transfer events for BOTH apps' references, so when the database settles a
// CareHub request this runs CareHub's effect; the send is stamped app 'carehub' so the drain renders the CareHub
// brand, never CareFind's.
export async function applyBusinessWithdrawalResult(supabase, result) {
  const apply = createBusinessWithdrawalEffects({
    supabase,
    send: async (message) => {
      await enqueueOutbox(message)
      await flushOutbox()
    },
    logger: { error: (msg, fields) => console.error(`[businessWithdrawalEffects] ${msg}`, fields) },
  })
  return apply(result)
}
