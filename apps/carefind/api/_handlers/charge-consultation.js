import { createClient } from '@supabase/supabase-js'
import { createPaymentIntent, markIntentPending, markIntentFailed, newReference } from '@care-ecosystem/shared-payments'
import { verifyUser } from '../_lib/verifyUser.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'

// Starts a professional consultation paid by CARD (used when the patient has not enough CareCoins).
//
// The fee is the professional's own offer (professional_consultations, status 'setup'), read here on
// the server; the client names only the professional. The amount is recorded as a payment intent before
// Paystack is contacted. A card payment never touches the patient's CareCoin wallet.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { professionalId, callback_url } = req.body || {}
  if (typeof professionalId !== 'string' || !professionalId || !callback_url) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  if (professionalId === user.id) {
    return res.status(400).json({ error: 'You cannot book a consultation with yourself' })
  }

  // The professional's offer is the source of truth for the fee.
  const { data: offer } = await supabase
    .from('professional_consultations')
    .select('fee, type')
    .eq('professional_id', professionalId)
    .eq('status', 'setup')
    .maybeSingle()

  const amountKobo = Math.round(Number(offer?.fee) * 100)
  if (!offer || !Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    return res.status(400).json({ error: 'Professional has no consultation offer' })
  }

  // Do not take money for a booking that already exists (settlement would only have to refund it).
  const { data: existing } = await supabase
    .from('professional_consultations')
    .select('id')
    .eq('professional_id', professionalId)
    .eq('patient_id', user.id)
    .eq('status', 'paid')
    .maybeSingle()
  if (existing) return res.status(409).json({ error: 'You already have a booking with this professional', alreadyBooked: true })

  const reference = newReference('cf_consult', user.id)
  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carefind',
      purpose: 'consultation',
      customerId: user.id,
      entityType: 'professional',
      entityId: professionalId,
      expectedAmountKobo: amountKobo,
      metadata: { consultation_type: offer.type || 'text' },
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'consultation', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  try {
    // Deliberately NO Paystack subaccount split. The whole charge settles to the platform account and
    // settle_payment_intent() credits the professional's CareCoin wallet (80%), which is how they are
    // paid. Splitting at Paystack as well would pay the professional twice.
    const init = await getPaystackProvider().initializePayment({
      reference,
      amountKobo: intent.expected_amount,
      email: user.email,
      callbackUrl: callback_url,
      metadata: { intent_id: intent.id, purpose: 'consultation' },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference })
  } catch (err) {
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
