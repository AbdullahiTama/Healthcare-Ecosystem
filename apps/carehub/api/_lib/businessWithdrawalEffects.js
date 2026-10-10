import { createBusinessWithdrawalEffects } from '@care-ecosystem/shared-payments'
import { emailService } from '../../src/lib/emailService.js'
import { flushOutbox } from './outbox.js'

// The owner's email after a business withdrawal settles (shared-payments/businessWithdrawalEffects.js).
// CareHub supplies how an email is queued and flushed; the effect itself is shared with CareFind's webhook.
export async function applyBusinessWithdrawalResult(supabase, result) {
  const apply = createBusinessWithdrawalEffects({
    supabase,
    send: async (message) => {
      await emailService.enqueue(message)
      await flushOutbox()
    },
    logger: { error: (msg, fields) => console.error(`[businessWithdrawalEffects] ${msg}`, fields) },
  })
  return apply(result)
}
