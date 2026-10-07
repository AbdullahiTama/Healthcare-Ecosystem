import { findIntent, PaymentIntentError } from './intents.js'
import { rpcWithRetry } from './rpcRetry.js'
import { isProviderError } from './errors.js'

// The ONE entry point that turns "the customer says they paid" or "the provider says it was paid"
// into settlement. The redirect handler and the webhook both call it, so there is a single
// definition of settlement: ask the provider about the reference, then hand its verified facts to
// settle_payment_intent() (Postgres), which does every check and every money movement atomically
// and idempotently.
//
// Outcomes:
//   unknown_reference   no intent with this reference (a payment from before payment intents, or someone else's): never guessed
//   already_settled     settled earlier; nothing moved now
//   settled             settled by this call (data carries the purpose-specific result)
//   needs_refund        paid, but cannot be applied (amount mismatch, already booked, ...): reason given
//   not_paid            the provider does not report a successful payment (yet)
//   rejected            the engine refused to touch it (transaction id conflict, ...)

/**
 * @param {object} p
 * @param {object} p.supabase   service-role client
 * @param {{name:string, verifyPayment:Function}} p.provider  a PaymentProvider
 * @param {string} p.reference
 * @param {{info:Function, warn:Function}} [p.logger]
 */
export async function settleByReference({ supabase, provider, reference, logger = { info() {}, warn() {} } }) {
  const intent = await findIntent(supabase, reference)
  if (!intent) return { outcome: 'unknown_reference', reference }

  if (intent.status === 'settled' || intent.status === 'refunded') {
    return { outcome: 'already_settled', intent_id: intent.id, purpose: intent.purpose, status: intent.status, intent }
  }

  let verified
  try {
    verified = await provider.verifyPayment({ reference })
  } catch (err) {
    // The provider has NEVER heard of this reference: no checkout was ever
    // completed (or the reference is invalid), so it can never pay out.
    // Treating this as an error would wedge retries forever; close it like a
    // provider-final failure instead of propagating.
    if (isProviderError(err) && err.code === 'not_found') {
      if (['created', 'pending'].includes(intent.status)) {
        await supabase.from('payment_intents').update({ status: 'failed' }).eq('id', intent.id).in('status', ['created', 'pending'])
      }
      return { outcome: 'not_paid', providerStatus: 'not_found', intent_id: intent.id, purpose: intent.purpose, intent }
    }
    throw err
  }
  if (verified.status !== 'success') {
    // A provider-final failure closes an open attempt; "pending" just means ask again later.
    if ((verified.status === 'failed' || verified.status === 'abandoned') && ['created', 'pending'].includes(intent.status)) {
      await supabase.from('payment_intents').update({ status: 'failed' }).eq('id', intent.id).in('status', ['created', 'pending'])
    }
    return { outcome: 'not_paid', providerStatus: verified.status, intent_id: intent.id, purpose: intent.purpose, intent }
  }

  // The engine is idempotent, so a deadlock / lock timeout / dropped connection is retried here instead of failing the payment.
  const { data, error } = await rpcWithRetry(supabase, 'settle_payment_intent', {
    p_reference: reference,
    p_provider: provider.name,
    p_provider_txn_id: verified.providerTransactionId,
    p_amount_kobo: verified.amountKobo,
    p_currency: verified.currency,
  }, { logger })
  if (error) throw new PaymentIntentError('settlement_failed', error.message)

  const result = Array.isArray(data) ? data[0] : data
  if (!result || typeof result.outcome !== 'string') throw new PaymentIntentError('settlement_failed', 'settlement returned no outcome')
  logger.info('payment.settlement', { reference, outcome: result.outcome, purpose: result.purpose, reason: result.reason })
  return { ...result, intent }
}
