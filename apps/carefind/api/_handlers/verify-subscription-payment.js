import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { paystackFetch } from '../_lib/paystack.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'

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

  const coinsInt = Number(metadata.coins)
  if (!Number.isInteger(coinsInt) || coinsInt > 12 || coinsInt <= 0) {
    return res.status(400).json({ error: 'Invalid subscription price: must be 1-12 CareCoins' })
  }

  // Atomic: claim reference, credit creator, extend subscription (no wallet debit)
  const { data, error } = await supabase.rpc('settle_subscription_payment', {
    p_subscriber: metadata.user_id,
    p_creator: metadata.creator_id,
    p_price: parseInt(metadata.coins),
    p_naira_amount: paystackData.data.amount,
    p_reference: reference,
  })

  if (error) return res.status(500).json({ error: error.message })
  const row = Array.isArray(data) ? data[0] : data
  if (row?.already_processed) {
    return res.status(200).json({ success: true, coins: parseInt(metadata.coins), alreadyProcessed: true })
  }

  // Subscription created email to the subscriber — enqueue + flush.
  try {
    const { data: creator } = await supabase
      .from('profiles')
      .select('display_name, full_name')
      .eq('id', metadata.creator_id)
      .maybeSingle()
    const { data: subscriber } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', metadata.user_id)
      .maybeSingle()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await enqueueOutbox({
      templateKey: 'subscription_created',
      toEmail: user.email,
      payload: {
        fullName: subscriber?.full_name || 'There',
        plan: `${parseInt(metadata.coins)} CareCoins`,
        businessName: creator?.display_name || creator?.full_name || 'Creator',
        expiryDate: expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      },
      subject: `You're subscribed — ${creator?.display_name || 'your subscription'} is active`,
    })
    flushOutbox().catch((err) => {
      console.error('[verify-subscription-payment] outbox flush error:', err)
    })
  } catch (err) {
    console.error('[verify-subscription-payment] subscription email error:', err)
  }

  return res.status(200).json({ success: true, coins: parseInt(metadata.coins) })
}
