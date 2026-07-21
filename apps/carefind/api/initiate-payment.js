import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { verifyUser } from './_lib/verifyUser.js'
import { TOPUP_PACKAGES } from './_lib/topupPackages.js'

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

  // Looked up server-side, never trusted from the client — a client-supplied
  // amount/coins pair here would let anyone request 99999 coins for the
  // price of the cheapest package.
  const pkg = TOPUP_PACKAGES[packageId]
  if (!pkg || !callback_url) {
    return res.status(400).json({ error: 'Missing or invalid package' })
  }

  const reference = `cf_${user.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: pkg.naira * 100,
        reference,
        callback_url,
        currency: 'NGN',
        metadata: { user_id: user.id, coins: pkg.coins },
      }),
    })

    const data = await response.json()

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Paystack error' })
    }

    return res.status(200).json({ authorization_url: data.data.authorization_url, reference })
  } catch (err) {
    return res.status(500).json({ error: 'Server error' })
  }
}
