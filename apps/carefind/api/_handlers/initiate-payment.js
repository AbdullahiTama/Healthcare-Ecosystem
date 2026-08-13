import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { verifyUser } from '../_lib/verifyUser.js'
import { paystackFetch } from '../_lib/paystack.js'
import { TOPUP_PACKAGES } from '../_lib/topupPackages.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { packageId, callback_url } = req.body

  // Looked up server-side, never trusted from the client ΓÇö a client-supplied
  // amount/coins pair here would let anyone request 99999 coins for the
  // price of the cheapest package.
  const pkg = TOPUP_PACKAGES[packageId]
  if (!pkg || !callback_url) {
    return res.status(400).json({ error: 'Missing or invalid package' })
  }

  const reference = `cf_${user.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`

  try {
    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: user.email,
        amount: pkg.naira * 100,
        reference,
        callback_url,
        currency: 'NGN',
        metadata: { user_id: user.id, coins: pkg.coins },
      }),
    })

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Paystack error' })
    }

    return res.status(200).json({ authorization_url: data.data.authorization_url, reference })
  } catch (err) {
    // Includes the descriptive "Invalid Paystack key" message when
    // PAYSTACK_SECRET_KEY is missing or a publishable key.
    return res.status(500).json({ error: err.message || 'Server error' })
  }
}
