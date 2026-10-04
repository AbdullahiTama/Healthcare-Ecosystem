import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { supabase } from '../_lib/supabase.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'
import { computeCommission } from '../_lib/commissions.js'

// Called when the business owner is redirected back from Paystack. Nothing is trusted from the client except
// which reference to look up: the plan, months, amount and business all come from the payment intent the
// server created, and settle_payment_intent() renews the plan only for a Paystack payment that matches it.
// The webhook calls the same settlement, so whichever arrives first renews and the other is a no-op.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'plan_renewal', business })

  if (out.outcome === 'already_settled') {
    // The webhook settled first. Its path does not compute the referral commission, so attempt it now
    // (idempotent: UNIQUE(payment_id)).
    const intent = out.result?.intent
    const { data: paymentRow } = await supabase.from('plan_payments').select('id, is_first_payment').eq('reference', reference).maybeSingle()
    if (paymentRow?.id) {
      try {
        await computeCommission(supabase, {
          paymentId: paymentRow.id,
          businessId: business.id,
          nairaCharged: (intent?.expected_amount || 0) / 100,
          isFirstPayment: paymentRow.is_first_payment,
        })
      } catch (err) {
        console.error('Commission computation failed:', err)
      }
    }
    return res.status(200).json({ alreadyProcessed: true })
  }
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  const { payment_id: paymentId, new_expiry: newExpiry, is_first_payment: isFirstPayment } = out.result
  if (paymentId) {
    try {
      await computeCommission(supabase, {
        paymentId,
        businessId: business.id,
        nairaCharged: out.result.intent.expected_amount / 100,
        isFirstPayment,
      })
    } catch (err) {
      console.error('Commission computation failed:', err)
    }
  }

  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ credited: true, newExpiry })
}
