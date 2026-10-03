import { createClient } from '@supabase/supabase-js'
import { createPaymentIntent, markIntentPending, markIntentFailed, newReference } from '@care-ecosystem/shared-payments'
import { verifyUser } from '../_lib/verifyUser.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { getFinancialConfig } from '../_lib/financialConfig.js'

// Starts a creator subscription paid by card (used when the wallet cannot cover it).
//
// The PRICE is the creator's own listed price (profiles.subscription_price), read here on the server.
// The client names only the creator; a price in the request body is ignored, so nobody can subscribe
// to a 12-coin creator for 1 coin (financial audit F-04). The amount is recorded as a payment intent
// before Paystack is contacted, and settlement later accepts only a payment that matches it.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { creatorId, callback_url } = req.body || {}
  if (typeof creatorId !== 'string' || !creatorId || !callback_url) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  if (creatorId === user.id) {
    return res.status(400).json({ error: 'You cannot subscribe to yourself' })
  }

  let price
  let coinValueKobo
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_price').eq('id', creatorId).maybeSingle()
    price = profile?.subscription_price
    const maxCoins = await getFinancialConfig(supabase, 'subscription_max_coins')
    coinValueKobo = await getFinancialConfig(supabase, 'coin_value_kobo')
    if (!Number.isInteger(price) || price <= 0 || price > maxCoins) {
      return res.status(400).json({ error: 'This creator is not offering subscriptions right now' })
    }
  } catch (err) {
    paymentLogger.error('payment.subscription.price_lookup_failed', { message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  const reference = newReference('cf_sub', user.id)
  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carefind',
      purpose: 'creator_subscription',
      customerId: user.id,
      entityType: 'creator',
      entityId: creatorId,
      expectedAmountKobo: price * coinValueKobo,
      metadata: { coins: price },
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'creator_subscription', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  try {
    // Deliberately NO Paystack subaccount split. The whole charge settles to the platform account and
    // settle_payment_intent() credits the creator's CareCoin wallet (80%), which is how they are paid.
    // Splitting at Paystack as well would pay the creator twice.
    const init = await getPaystackProvider().initializePayment({
      reference,
      amountKobo: intent.expected_amount,
      email: user.email,
      callbackUrl: callback_url,
      metadata: { intent_id: intent.id, purpose: 'creator_subscription' },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference })
  } catch (err) {
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
