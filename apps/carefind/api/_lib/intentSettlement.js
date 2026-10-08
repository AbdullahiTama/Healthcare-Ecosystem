import { settleIntentForRequest as settleForRequest } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from './payments.js'

// CareFind's "I came back from Paystack" settlement (logic shared with CareHub in shared-payments): a
// signed-in caller may settle only their OWN payment; an anonymous caller (guest booking) is allowed
// because the unguessable reference is their handle.
//
// -> { http, body, outcome, result }
// `entityId`, when the client named the thing it is paying for (an order), must be the intent's own entity: a reference can never
// be used to settle a different order than the one named.
export function settleIntentForRequest({ supabase, reference, purpose, user = null, entityId = null, provider = getPaystackProvider() }) {
  return settleForRequest({
    supabase,
    provider,
    reference,
    purpose,
    authorize: (intent) => (!user || intent.customer_id === user.id) && (!entityId || intent.entity_id === entityId),
    logger: paymentLogger,
  })
}
