import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { supabase } from '../_lib/supabase.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

// Called when the business is redirected back from Paystack after paying for an appointment. The amount,
// appointment and business come from the payment intent the server created; settle_payment_intent() credits
// the business wallet (80% held, 20% platform) from the amount ACTUALLY paid. The webhook calls the same
// settlement, so whichever arrives first settles and the other is a no-op.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'appointment', business })
  const appointmentId = out.result?.intent?.entity_id

  if (out.outcome === 'unknown_reference') {
    // An appointment paid before payment intents existed has no intent; this only REPORTS it if it is already paid (nothing settles from here).
    const { data: legacy } = await supabase.from('appointments').select('id, payment_status').eq('payment_reference', reference).eq('business_id', business.id).maybeSingle()
    if (legacy?.payment_status === 'paid') return res.status(200).json({ success: true, id: legacy.id, alreadyPaid: true })
    return res.status(404).json({ error: 'No appointment found for this reference' })
  }
  if (out.outcome === 'already_settled') return res.status(200).json({ success: true, id: appointmentId, alreadyPaid: true })
  if (out.outcome === 'needs_refund' && out.result?.reason === 'already_paid') {
    // Paid another way in the meantime (POS / transfer): the appointment stays paid, this card payment is queued for refund.
    return res.status(200).json({ success: true, id: appointmentId, alreadyPaid: true, needsRefund: true })
  }
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  // Staff notice and client confirmation: run once, by the call that actually settled the intent.
  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ success: true, id: appointmentId, paid: true })
}
