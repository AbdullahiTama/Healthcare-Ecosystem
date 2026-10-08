import { settleIntentForRequest as settleForRequest } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from './payments.js'

// CareHub's "I came back from Paystack" settlement (logic shared with CareFind in shared-payments). The
// caller is a verified business owner (verifyBusiness); they may settle only a payment that was created for
// THEIR business.
//
// -> { http, body, outcome, result }
export function settleIntentForRequest({ supabase, reference, purpose, business, provider = getPaystackProvider() }) {
  return settleForRequest({
    supabase,
    provider,
    reference,
    purpose,
    authorize: (intent) => Boolean(business?.id) && intent.business_id === business.id,
    logger: paymentLogger,
  })
}
