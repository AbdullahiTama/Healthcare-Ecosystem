import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Called when the user is redirected back from Paystack, so the wallet updates immediately rather than
// waiting on the webhook. Nothing is trusted from the client except which reference to look up: the
// coins, amount and owner all come from the payment intent the server created, and settlement only
// accepts a Paystack payment that matches it exactly. The webhook calls the same settlement.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'wallet_topup', user })
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  const { coins, new_balance: newBalance } = out.result
  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ credited: coins, newBalance })
}
