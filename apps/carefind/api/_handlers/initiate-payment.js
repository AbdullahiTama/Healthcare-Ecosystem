import { createClient } from '@supabase/supabase-js'
import { createPaymentIntent, markIntentPending, markIntentFailed, newReference } from '@care-ecosystem/shared-payments'
import { verifyUser } from '../_lib/verifyUser.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { TOPUP_PACKAGES } from '../_lib/topupPackages.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Starts a CareCoin top-up. The client names a package id and nothing else that matters: the amount,
// the coins and the payer are decided here and recorded as a payment intent BEFORE the customer is
// sent to Paystack. Settlement later accepts only a Paystack payment that matches that intent.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { packageId, callback_url } = req.body || {}

  // Looked up server-side, never trusted from the client: a client-supplied amount/coins pair here
  // would let anyone request 99999 coins for the price of the cheapest package.
  const pkg = Object.hasOwn(TOPUP_PACKAGES, String(packageId)) ? TOPUP_PACKAGES[packageId] : null
  if (!pkg || !callback_url) {
    return res.status(400).json({ error: 'Missing or invalid package' })
  }

  const reference = newReference('cf_topup', user.id)
  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carefind',
      purpose: 'wallet_topup',
      customerId: user.id,
      expectedAmountKobo: pkg.naira * 100,
      metadata: { coins: pkg.coins, package_id: String(packageId) },
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'wallet_topup', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  try {
    const init = await getPaystackProvider().initializePayment({
      reference,
      amountKobo: intent.expected_amount,
      email: user.email,
      callbackUrl: callback_url,
      metadata: { intent_id: intent.id, purpose: 'wallet_topup' },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference })
  } catch (err) {
    // A definite refusal closes the intent. An ambiguous failure leaves it open: the customer was
    // never sent a checkout link, and the intent simply expires.
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    // Includes the descriptive "Invalid Paystack key" message when the key is missing or publishable.
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
