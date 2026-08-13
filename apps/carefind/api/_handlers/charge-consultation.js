import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { verifyUser } from './_lib/verifyUser.js'
import { paystackFetch } from './_lib/paystack.js'

// Initializes a Paystack transaction for a professional consultation.
// Called when a patient wants to book a consultation but doesn't have enough
// CareCoins in their wallet ΓÇö this lets them pay directly via card/transfer.
// Settlement happens atomically in settle_consultation_payment() via the
// webhook (or verify-consultation-payment.js on redirect).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { professionalId, callback_url } = req.body
  if (!professionalId || !callback_url) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // The professional's offer is the source of truth for the fee.
  const { data: offer } = await supabase
    .from('professional_consultations')
    .select('fee, type')
    .eq('professional_id', professionalId)
    .eq('status', 'setup')
    .maybeSingle()

  if (!offer || !offer.fee || offer.fee <= 0) {
    return res.status(400).json({ error: 'Professional has no consultation offer' })
  }

  const nairaAmount = Math.round(Number(offer.fee))
  const reference = `cf_consult_${user.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`

  try {
    const body = {
      email: user.email,
      amount: nairaAmount * 100,
      reference,
      callback_url,
      currency: 'NGN',
      metadata: {
        user_id: user.id,
        professional_id: professionalId,
        fee: nairaAmount,
        purpose: 'consultation',
      },
    }

    // If the professional has a Paystack subaccount, split the payment
    const { data: proProfile } = await supabase
      .from('profiles')
      .select('paystack_subaccount_code')
      .eq('id', professionalId)
      .maybeSingle()

    if (proProfile?.paystack_subaccount_code) {
      body.subaccount = proProfile.paystack_subaccount_code
      body.transaction_charge = Math.floor(nairaAmount * 100 * 0.15) // 15% platform fee
    }

    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!data.status) return res.status(400).json({ error: data.message || 'Paystack error' })

    return res.status(200).json({ authorization_url: data.data.authorization_url, reference })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' })
  }
}
