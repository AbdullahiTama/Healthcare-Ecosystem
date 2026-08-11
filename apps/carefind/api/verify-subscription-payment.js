import { createClient } from '@supabase/supabase-js'
import { verifyUser } from './_lib/verifyUser.js'
import { paystackFetch } from './_lib/paystack.js'

// Called when the user is redirected back from Paystack after subscribing
// directly via card. Verifies the payment with Paystack, then creates the
// subscription and credits the creator's wallet atomically.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { reference } = req.body
  if (!reference) return res.status(400).json({ error: 'Missing reference' })

  let paystackData
  try {
    paystackData = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not verify payment' })
  }

  if (!paystackData.status || paystackData.data?.status !== 'success') {
    return res.status(400).json({ error: 'Payment not confirmed by Paystack' })
  }

  const { metadata } = paystackData.data
  if (!metadata?.user_id || !metadata?.creator_id || !metadata?.coins || metadata?.purpose !== 'subscription') {
    return res.status(400).json({ error: 'Invalid transaction metadata' })
  }

  if (metadata.user_id !== user.id) {
    return res.status(403).json({ error: 'This transaction does not belong to you' })
  }

  // Atomic: credit creator's wallet and create subscription
  const { data, error } = await supabase.rpc('pay_creator_subscription', {
    p_subscriber: metadata.user_id,
    p_creator: metadata.creator_id,
    p_price: parseInt(metadata.coins),
  })

  if (error) return res.status(500).json({ error: error.message })
  if (data === 'insufficient') {
    // This shouldn't happen since we're charging via Paystack, not wallet
    return res.status(400).json({ error: 'Could not complete subscription' })
  }

  // Record the Paystack payment
  await supabase.from('transactions').insert({
    user_id: metadata.user_id,
    type: 'subscription_payment',
    amount: parseInt(metadata.coins),
    naira_amount: paystackData.data.amount,
    reference,
    status: 'success',
  }).select().maybeSingle()

  return res.status(200).json({ success: true, coins: parseInt(metadata.coins) })
}