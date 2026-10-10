import { settleByReference, settleTransferWebhook, settleRefundWebhook } from '@care-ecosystem/shared-payments'
import { applyWithdrawalResult } from './withdrawalEffects.js'
import { applyBusinessWithdrawalResult } from './businessWithdrawalEffects.js'
import { applyRefundResult } from './refundEffects.js'
import { getPaystackProvider, paymentLogger } from './payments.js'
import { runSettlementEffects } from './settlementEffects.js'

// What a Paystack event MEANS, separated from the HTTP handling so the same function serves the live webhook AND the replay
// sweep (a stored event whose first processing failed is processed again from its saved payload, by exactly this code).
//   charge.success   -> the ONE settlement engine (settle_payment_intent). The event decides nothing: the payment intent recorded
//                       before checkout names the purpose, payer, payee and amount, and Paystack is asked directly.
//   transfer.*       -> the withdrawal engine
//   refund.*         -> the refund engine
// Nothing dispatches on the event's `metadata`: that is client-influenced data. Every branch is idempotent, and an error THROWS so
// the caller records the event as failed and it is retried.

// Transfer webhooks (automated withdrawal payouts). The DATABASE settles them (settle_withdrawal /
// settle_business_withdrawal: replay-safe, refunds at most once, completes only for the amount reserved, and a
// reversal of an already-completed transfer is refunded); this only maps the event to an outcome and runs the
// side effects (trust tier, email) for a change THIS delivery made. An RPC error throws, so the event is
// recorded as failed and Paystack's retry settles it.
async function handleTransferEvent(supabase, event) {
  const settled = await settleTransferWebhook(supabase, event, { logger: paymentLogger })
  if (settled.kind === 'carefind') await applyWithdrawalResult(supabase, settled.outcome, settled.result)
  // The shared endpoint serves both apps' transfer references: a CareHub request gets CareHub's owner email.
  else if (settled.kind === 'carehub') await applyBusinessWithdrawalResult(supabase, settled.result)
  return { received: true }
}

// Refund webhooks (refund.pending / processing / processed / failed). The DATABASE settles them (settle_refund: replay-safe,
// completes only for the refunded amount, a failure restores the business exactly, contradictions are reported). An RPC
// error throws so the event is recorded as failed and Paystack's retry settles it.
async function handleRefundEvent(supabase, event) {
  // Only a delivery that flips the refund completed notifies the payer (refunds.js fires onSettled exactly then).
  await settleRefundWebhook(supabase, event, { logger: paymentLogger, onSettled: (result) => applyRefundResult(supabase, result) })
  return { received: true }
}

// Settlement of a gateway payment. Every payment now has a payment intent (recorded before checkout), so this is the only
// settlement path. -> the engine's answer, or null when the reference is not ours / not an intent.
async function settleIntentPayment(supabase, reference) {
  const result = await settleByReference({ supabase, provider: getPaystackProvider(), reference, logger: paymentLogger })
  if (result.outcome === 'unknown_reference') return null
  if (result.outcome === 'not_paid' || result.outcome === 'rejected') {
    // Paystack says charge.success but the verify call disagrees (or the engine refused): do not
    // acknowledge, so Paystack redelivers and the state is re-examined.
    throw new Error(`intent ${reference} not settled: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`)
  }
  if (result.outcome === 'needs_refund') {
    // Money received that could not be applied. Never dropped: the intent is parked as needs_refund and the refund engine
    // (cron) refunds it.
    console.error('[payment-needs-refund]', { reference, purpose: result.purpose, reason: result.reason })
  }
  await runSettlementEffects(supabase, result) // only the call that actually settled sends emails/notices
  return result
}

// -> 'processed' | 'ignored'
export async function processWebhookEvent(supabase, event) {
  // Dispatch by event type
  if (event.event === 'charge.success') {
    const reference = event.data?.reference
    if (reference && await settleIntentPayment(supabase, reference)) return 'processed'
    // A successful charge that no payment intent recognises: not one of ours (another Paystack integration on the same account),
    // or a payment started before payment intents existed. It is acknowledged (a retry cannot change it) but logged LOUDLY so
    // reconciliation / an operator sees real money that nothing settled. NEVER guessed from its metadata.
    paymentLogger.error('payment.unmatched_charge', { reference: reference || null, amount: event.data?.amount ?? null, currency: event.data?.currency ?? null })
    return 'ignored'
  }

  if (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await handleTransferEvent(supabase, event)
    return 'processed'
  }

  if (event.event === 'refund.processed' || event.event === 'refund.failed' || event.event === 'refund.pending' || event.event === 'refund.processing') {
    await handleRefundEvent(supabase, event)
    return 'processed'
  }
  return 'ignored'
}
