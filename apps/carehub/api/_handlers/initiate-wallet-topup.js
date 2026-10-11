import { createPaymentIntent, markIntentPending, markIntentFailed, newReference, resolveCallbackUrl, topupFee, getTopupFeeRate } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'

const MIN_TOPUP_KOBO = 10_000 // N100
const MAX_TOPUP_KOBO = 10_000_000 // N100,000

// Starts a CareHub business-wallet top-up. The amount is chosen by the business but bounded (it is the amount the
// wallet RECEIVES); the card is charged that amount PLUS the processing fee
// (financial_config.topup_processing_fee_rate, 10%). The intent is recorded before Paystack is contacted, with the base
// and the fee beside the total, and settlement credits the wallet the base only, for a provider payment that matches the
// total exactly. `{ quote: true }` returns the current fee rate and creates nothing.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { amount, callback_url, quote } = req.body || {}

  if (quote === true) {
    return res.status(200).json({ fee_rate: await getTopupFeeRate(supabase, { logger: paymentLogger }) })
  }

  const amountKobo = Number(amount)
  if (!Number.isSafeInteger(amountKobo) || amountKobo < MIN_TOPUP_KOBO || amountKobo > MAX_TOPUP_KOBO || !callback_url) {
    return res.status(400).json({ error: 'Amount must be a whole-kobo integer between N100 and N100,000' })
  }

  // Where Paystack sends the customer back: only an origin this platform owns (audit F-27), never what the browser names.
  const callback = resolveCallbackUrl({ requested: callback_url, req })
  if (!callback.ok) return res.status(400).json({ error: 'Invalid return address', code: 'invalid_callback_url' })

  const rate = await getTopupFeeRate(supabase, { logger: paymentLogger })
  const fee = topupFee({ baseKobo: amountKobo, rate })

  const reference = newReference('ch_topup', business.id)

  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carehub',
      purpose: 'business_wallet_topup',
      businessId: business.id,
      expectedAmountKobo: fee.totalKobo,
      metadata: { base_amount_kobo: fee.baseKobo, fee_kobo: fee.feeKobo, fee_rate: fee.rate },
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
      callbackUrl: callback.url,
      metadata: { intent_id: intent.id, purpose: 'business_wallet_topup' },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference, base_kobo: fee.baseKobo, fee_kobo: fee.feeKobo, total_kobo: fee.totalKobo })
  } catch (err) {
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
