import { createPaymentIntent, markIntentPending, markIntentFailed, newReference } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { PLAN_MONTHLY_NAIRA, PLAN_YEARLY_NAIRA } from '../../src/lib/planLimits.js'

// Starts a CareHub plan payment. The business is the verified owner's (never from the body) and the PRICE is
// looked up here from the plan table; the client chooses only 1 month or the annual option. The amount is
// recorded as a payment intent before Paystack is contacted, and settlement later accepts only a Paystack
// payment that matches it exactly (amount, currency, provider) for that business.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { months, callback_url } = req.body || {}
  // Only whole-month or the landing page's "pay 10 months, get 12" annual option - anything else would need
  // a price the client can't be trusted to state itself.
  if ((months !== 1 && months !== 12) || !callback_url) {
    return res.status(400).json({ error: 'Invalid request' })
  }

  const yearlyPrice = PLAN_YEARLY_NAIRA[business.plan]
  const monthlyPrice = PLAN_MONTHLY_NAIRA[business.plan]
  if (yearlyPrice === null || yearlyPrice === undefined) {
    // Custom or unknown - no fixed Paystack price
    return res.status(400).json({ error: 'Custom plan — contact support@carehub.ng for a tailored quote' })
  }
  if (!monthlyPrice || !yearlyPrice) return res.status(400).json({ error: 'Unknown plan' })

  const naira = months === 12 ? yearlyPrice : monthlyPrice
  const reference = newReference('ch_plan', business.id)

  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carehub',
      purpose: 'plan_renewal',
      businessId: business.id,
      expectedAmountKobo: naira * 100,
      metadata: { months, plan: business.plan },
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'plan_renewal', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  try {
    const init = await getPaystackProvider().initializePayment({
      reference,
      amountKobo: intent.expected_amount,
      email: business.email,
      callbackUrl: callback_url,
      metadata: { intent_id: intent.id, purpose: 'plan_renewal' },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference })
  } catch (err) {
    // A definite refusal closes the intent; an ambiguous failure leaves it open to expire (the customer was
    // never sent a checkout link).
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
