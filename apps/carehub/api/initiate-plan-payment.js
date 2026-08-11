import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { verifyBusiness } from './_lib/verifyBusiness.js'
import { paystackFetch } from './_lib/paystack.js'
import { PLAN_MONTHLY_NAIRA } from '../src/lib/planLimits.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { months, callback_url } = req.body
  // Only whole-month or the landing page's "pay 10 months, get 12" annual
  // option — anything else would need a price the client can't be trusted
  // to state itself.
  if ((months !== 1 && months !== 12) || !callback_url) {
    return res.status(400).json({ error: 'Invalid request' })
  }

  const monthlyPrice = PLAN_MONTHLY_NAIRA[business.plan]
  if (!monthlyPrice) return res.status(400).json({ error: 'Unknown plan' })

  const naira = monthlyPrice * (months === 12 ? 10 : 1)
  const reference = `ch_${business.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`

  try {
    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: business.email,
        amount: naira * 100,
        reference,
        callback_url,
        currency: 'NGN',
        metadata: { business_id: business.id, months },
      }),
    })

    if (!data.status) return res.status(400).json({ error: data.message || 'Paystack error' })

    return res.status(200).json({ authorization_url: data.data.authorization_url, reference })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' })
  }
}
