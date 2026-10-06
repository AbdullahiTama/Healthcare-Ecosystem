import { createClient } from '@supabase/supabase-js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'
import { verifyUser } from '../_lib/verifyUser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Verifies a Paystack payment for a shop order and marks it paid. Called when the customer is redirected back from Paystack; the
// Paystack webhook calls the same settlement, so whichever arrives first settles and the other is a no-op.
// Body: { order_id?, reference }
//
// Nothing is trusted from the client except which reference to look up. The amount, customer, vendor and order all come from the
// payment intent the server recorded before checkout, and settle_payment_intent() marks the order paid only for a Paystack payment
// that matches it. A signed-in caller may settle only their OWN payment; the redirect may arrive without a session, in which case
// the unguessable reference is the handle (the money can only ever go to the order the intent names).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  const { order_id: orderId, reference: bodyReference } = req.body || {}
  if (!bodyReference && !orderId) return res.status(400).json({ error: 'Missing order_id or reference' })

  // The client may name only the order: its latest attempt is the order's payment_reference.
  let reference = bodyReference
  if (!reference) {
    const { data: o } = await supabase.from('shop_orders').select('payment_reference').eq('id', orderId).maybeSingle()
    reference = o?.payment_reference
    if (!reference) return res.status(400).json({ error: 'No payment reference' })
  }

  const out = await settleIntentForRequest({ supabase, reference, purpose: 'shop_order', user, entityId: orderId || null })

  if (out.outcome === 'unknown_reference') {
    // A payment attempt from before payment intents existed. If its order is already paid there is nothing to do.
    const { data: legacy } = await supabase.from('shop_orders').select('id, payment_status, status').eq('payment_reference', reference).maybeSingle()
    if (legacy && (legacy.payment_status === 'paid' || legacy.status === 'paid')) return res.status(200).json({ success: true, id: legacy.id, alreadyPaid: true })
    return res.status(404).json({ error: 'Order not found for this reference' })
  }

  // (A reference that belongs to a different order than the one the client named was refused above, before anything was settled.)
  const orderIdFromIntent = out.result?.intent?.entity_id

  if (out.outcome === 'already_settled') return res.status(200).json({ success: true, id: orderIdFromIntent, alreadyPaid: true })
  if (out.outcome === 'needs_refund' && out.result?.reason === 'already_paid') {
    // The order was already paid (an earlier attempt): it stays paid, this payment is queued for refund.
    return res.status(200).json({ success: true, id: orderIdFromIntent, alreadyPaid: true, needsRefund: true })
  }
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  // Vendor notice, purchase pattern and the customer's confirmation: run once, by the call that actually settled the intent.
  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ success: true, id: out.result.order_id, paid: true })
}
