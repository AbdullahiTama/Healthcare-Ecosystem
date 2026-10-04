import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { supabase } from '../_lib/supabase.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

// Called when the business owner is redirected back from Paystack. Nothing is trusted from the client except
// which reference to look up: the plan, months, amount and business all come from the payment intent the
// server created, and settle_payment_intent() renews the plan only for a Paystack payment that matches it.
// The webhook calls the same settlement, so whichever arrives first renews and the other is a no-op.
// The referral commission is created by the database inside the renewal itself (renew_business_plan), so there
// is nothing to compute here: whichever door settled, the payment already has its commission or review flag.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'plan_renewal', business })

  if (out.outcome === 'already_settled') return res.status(200).json({ alreadyProcessed: true })
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  const { new_expiry: newExpiry } = out.result

  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ credited: true, newExpiry })
}
