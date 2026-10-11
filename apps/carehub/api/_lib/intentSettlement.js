import { settleIntentForRequest as settleForRequest } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from './payments.js'
import { runSettlementEffects } from './settlementEffects.js'

// CareHub's "I came back from Paystack" settlement (logic shared with CareFind in shared-payments). The
// caller is a verified business owner (verifyBusiness); they may settle only a payment that was created for
// THEIR business.
//
// -> { http, body, outcome, result }
export async function settleIntentForRequest({ supabase, reference, purpose, business, provider = getPaystackProvider() }) {
  const out = await settleForRequest({
    supabase,
    provider,
    reference,
    purpose,
    authorize: (intent) => Boolean(business?.id) && intent.business_id === business.id,
    logger: paymentLogger,
  })
  // A payment the provider declined is announced once (the effect ignores every other not-paid case and a replay).
  if (out.outcome === 'not_paid') await runSettlementEffects(supabase, out.result).catch((err) => paymentLogger.error('payment.failed_notice_failed', { reference, message: err?.message }))
  return out
}
