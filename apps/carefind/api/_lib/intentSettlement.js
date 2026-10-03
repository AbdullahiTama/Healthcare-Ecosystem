import { findIntent, settleByReference, isProviderError } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from './payments.js'

// What every CareFind "I came back from Paystack" endpoint does, once: look the reference up, make sure
// it is the right kind of payment and the caller's own, then settle through the engine. The handlers
// that call this only add what is specific to their flow (response fields, emails).
//
// -> { http, body, outcome, result }   `result` is the engine's answer when it ran.
export async function settleIntentForRequest({ supabase, reference, purpose, user = null, provider = getPaystackProvider() }) {
  if (typeof reference !== 'string' || !reference) return { http: 400, body: { error: 'Missing reference' }, outcome: 'invalid' }

  const intent = await findIntent(supabase, reference)
  // Payments started before the settlement engine have no intent; the webhook still settles those.
  if (!intent) return { http: 404, body: { error: 'No payment found for this reference' }, outcome: 'unknown_reference' }
  if (intent.purpose !== purpose) return { http: 400, body: { error: 'This payment is not for this purpose' }, outcome: 'wrong_purpose' }
  if (user && intent.customer_id !== user.id) {
    return { http: 403, body: { error: 'This transaction does not belong to you' }, outcome: 'forbidden' }
  }

  let result
  try {
    result = await settleByReference({ supabase, provider, reference, logger: paymentLogger })
  } catch (err) {
    paymentLogger.error('payment.settle.failed', { reference, purpose, code: err.code, message: err.message })
    return { http: isProviderError(err) ? 502 : 500, body: { error: 'Could not verify your payment right now. Please try again in a moment.' }, outcome: 'error' }
  }

  switch (result.outcome) {
    case 'settled':
      return { http: 200, body: {}, outcome: 'settled', result }
    case 'already_settled':
      return { http: 200, body: { alreadyProcessed: true }, outcome: 'already_settled', result }
    case 'not_paid':
      return { http: 400, body: { error: 'Payment not confirmed by Paystack' }, outcome: 'not_paid', result }
    case 'needs_refund':
      return {
        http: 409,
        body: { error: 'Your payment was received but could not be applied. It will be refunded.', needsRefund: true, reason: result.reason },
        outcome: 'needs_refund',
        result,
      }
    default:
      return { http: 500, body: { error: 'Could not settle your payment' }, outcome: result.outcome, result }
  }
}
