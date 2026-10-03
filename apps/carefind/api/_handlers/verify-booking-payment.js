import { createClient } from '@supabase/supabase-js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Verifies a Paystack payment for a consultation booking and marks the appointment paid. Called when the
// client is redirected back from Paystack (so the dashboard updates immediately); the Paystack webhook
// calls the same settlement.
//
// Nothing is trusted from the client except which reference to look up. The amount, appointment and
// business all come from the payment intent the server created when the booking was made, and
// settle_payment_intent() credits the business from the amount actually paid. Bookings can be
// anonymous, so there is no signed-in user: the unguessable reference is the patient's handle.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { reference } = req.body || {}
  if (!reference) return res.status(400).json({ error: 'Missing reference' })

  const out = await settleIntentForRequest({ supabase, reference, purpose: 'booking' })

  // A booking paid just before the settlement engine shipped has no intent; the webhook settles those.
  if (out.outcome === 'unknown_reference') {
    const { data: legacy } = await supabase.from('appointments').select('id, payment_status').eq('payment_reference', reference).maybeSingle()
    if (legacy?.payment_status === 'paid') return res.status(200).json({ success: true, id: legacy.id, alreadyPaid: true })
    return res.status(404).json({ error: 'No booking found for this reference' })
  }

  const appointmentId = out.result?.intent?.entity_id
  if (out.outcome === 'already_settled') return res.status(200).json({ success: true, id: appointmentId, alreadyPaid: true })
  if (out.outcome === 'needs_refund' && out.result?.reason === 'already_paid') {
    // The appointment was already paid (e.g. with CareCoins): it stays booked, this card payment is queued for refund.
    return res.status(200).json({ success: true, id: appointmentId, alreadyPaid: true, needsRefund: true })
  }
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  // Business notification and client email: run once, by the call that actually settled the intent.
  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ success: true, id: appointmentId, paid: true })
}
