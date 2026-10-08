import { findIntent } from './intents.js'
import { settleByReference } from './settlement.js'
import { isProviderError } from './errors.js'

// What every "I came back from the provider" endpoint does, once, for either app: look the reference up,
// make sure it is the right kind of payment and the caller's own, then settle through the engine. The
// handlers that call this add only what is specific to their flow (response fields, effects).
//
// `authorize(intent)` is the app's own ownership rule (CareFind: the intent's customer is the signed-in
// user; CareHub: the intent's business is the caller's business; anonymous bookings: always true because
// the unguessable reference is the patient's handle).
//
// -> { http, body, outcome, result }   `result` is the engine's answer when it ran.
export async function settleIntentForRequest({ supabase, provider, reference, purpose, authorize = () => true, logger = { info() {}, warn() {}, error() {} } }) {
  if (typeof reference !== 'string' || !reference) return { http: 400, body: { error: 'Missing reference' }, outcome: 'invalid' }

  const intent = await findIntent(supabase, reference)
  // No intent: not one of ours, or a payment started before payment intents existed. The webhook no longer settles from event metadata, so
  // the caller can only report it (read-only) - the engine never guesses.
  if (!intent) return { http: 404, body: { error: 'No payment found for this reference' }, outcome: 'unknown_reference' }
  if (intent.purpose !== purpose) return { http: 400, body: { error: 'This payment is not for this purpose' }, outcome: 'wrong_purpose' }
  if (!authorize(intent)) return { http: 403, body: { error: 'This transaction does not belong to you' }, outcome: 'forbidden' }

  let result
  try {
    result = await settleByReference({ supabase, provider, reference, logger })
  } catch (err) {
    logger.error('payment.settle.failed', { reference, purpose, code: err.code, message: err.message })
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
