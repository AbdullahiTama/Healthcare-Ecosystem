import { createPaymentIntent, markIntentPending, markIntentFailed, newReference } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'

const MIN_TOPUP_KOBO = 10_000 // N100
const MAX_TOPUP_KOBO = 10_000_000 // N100,000

// Starts a CareHub business-wallet top-up. The amount is chosen by the business but bounded;
// the intent is recorded before Paystack is contacted and settlement credits the wallet only
// for a provider payment that matches it exactly.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { amount, callback_url } = req.body || {}
  const amountKobo = Number(amount)
  if (!Number.isSafeInteger(amountKobo) || amountKobo < MIN_TOPUP_KOBO || amountKobo > MAX_TOPUP_KOBO || !callback_url) {
    return res.status(400).json({ error: 'Amount must be a whole-kobo integer between N100 and N100,000' })
  }

  const reference = newReference('ch_topup', business.id)

  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carehub',
      purpose: 'business_wallet_topup',
      businessId: business.id,
      expectedAmountKobo: amountKobo,
      metadata: {},
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'business_wallet_topup', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  try {
    const init = await getPaystackProvider().initializePayment({
      reference,
      amountKobo: intent.expected_amount,
      email: business.email,
      callbackUrl: callback_url,
      metadata: { intent_id: intent.id, purpose: 'business_wallet_topup' },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference })
  } catch (err) {
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
