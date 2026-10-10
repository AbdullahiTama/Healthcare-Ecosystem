import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { supabase } from '../_lib/supabase.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

// Called when the business owner is redirected back from Paystack. Settles the intent; the
// engine credits business_wallets.available_balance only for a provider payment that matches
// the intent exactly. The webhook calls the same settlement, so the first door wins.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'business_wallet_topup', business })

  if (out.outcome === 'already_settled') return res.status(200).json({ alreadyProcessed: true })
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ credited: true, newAvailable: out.result.new_available })
}
