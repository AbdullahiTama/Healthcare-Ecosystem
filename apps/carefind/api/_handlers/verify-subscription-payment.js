import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'

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
  // Subscription created email to the subscriber - never blocks the outcome.
  try {
    const { data: creator } = await supabase.from('profiles').select('display_name, full_name').eq('id', intent.entity_id).maybeSingle()
    const { data: subscriber } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await enqueueOutbox({
      templateKey: 'subscription_created',
      toEmail: user.email,
      payload: {
        fullName: subscriber?.full_name || 'There',
        plan: `${coins} CareCoins`,
        businessName: creator?.display_name || creator?.full_name || 'Creator',
        expiryDate: expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      },
      subject: `You're subscribed - ${creator?.display_name || 'your subscription'} is active`,
      idempotencyKey: `subscription-started:${reference}`,
    })
    flushOutbox().catch((err) => console.error('[verify-subscription-payment] outbox flush error:', err))
  } catch (err) {
    console.error('[verify-subscription-payment] subscription email error:', err)
  }

  return res.status(200).json({ success: true, coins })
}
