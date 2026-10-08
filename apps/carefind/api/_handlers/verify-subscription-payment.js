import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

// Called when the user is redirected back from Paystack after subscribing by card. Settlement (creator
// credit, platform fee, 30 days of access) happens in settle_payment_intent(), the same function the
// webhook uses, so whichever arrives first settles and the other is a no-op.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'creator_subscription', user })
  const intent = out.result?.intent
  if (out.outcome === 'already_settled') {
    return res.status(200).json({ success: true, coins: Number(intent?.metadata?.coins) || undefined, alreadyProcessed: true })
  }
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  const coins = Number(intent.metadata?.coins)
  await runSettlementEffects(supabase, out.result)

  return res.status(200).json({ success: true, coins })
}
