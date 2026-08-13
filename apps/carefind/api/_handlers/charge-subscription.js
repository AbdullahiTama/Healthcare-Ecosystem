import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { paystackFetch } from '../_lib/paystack.js'

// Initializes a Paystack transaction for a creator subscription.
// Called when a user wants to subscribe but doesn't have enough CareCoins
// in their wallet ΓÇö this lets them pay directly via card/transfer.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const NAIRA_PER_COIN = 200

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { creatorId, priceCoins, callback_url } = req.body
  if (!creatorId || !priceCoins || !callback_url) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const price = parseInt(priceCoins, 10)
  if (price <= 0 || price > 100) {
    return res.status(400).json({ error: 'Invalid price' })
  }

  const nairaAmount = price * NAIRA_PER_COIN
  const reference = `cf_sub_${user.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`
  const subaccountCode = null // Will be set when subaccount support is active

  try {
    const body = {
      email: user.email,
      amount: nairaAmount * 100,
      reference,
      callback_url,
      currency: 'NGN',
      metadata: {
        user_id: user.id,
        creator_id: creatorId,
        coins: price,
        purpose: 'subscription',
      },
    }

    // If the creator has a Paystack subaccount, split the payment
    const { data: creatorProfile } = await supabase
      .from('profiles')
      .select('paystack_subaccount_code')
      .eq('id', creatorId)
      .maybeSingle()

    if (creatorProfile?.paystack_subaccount_code) {
      body.subaccount = creatorProfile.paystack_subaccount_code
      body.transaction_charge = Math.floor(nairaAmount * 100 * 0.1) // 10% platform fee
    }

    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!data.status) return res.status(400).json({ error: data.message || 'Paystack error' })

    return res.status(200).json({ authorization_url: data.data.authorization_url, reference })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' })
  }
}
