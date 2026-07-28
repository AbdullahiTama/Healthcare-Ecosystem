import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Paystack webhook for subscription payments — backup path when the user's
// redirect from verify-subscription-payment.js is missed.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const config = { api: { bodyParser: false } }

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const rawBody = await readRawBody(req)
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex')

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = JSON.parse(rawBody.toString('utf8'))

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data

    if (metadata?.purpose !== 'subscription') {
      return res.status(200).json({ received: true })
    }

    // Check if already processed
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .eq('type', 'subscription_payment')
      .maybeSingle()

    if (existing) return res.status(200).json({ already_processed: true })

    const { data, error } = await supabase.rpc('pay_creator_subscription', {
      p_subscriber: metadata.user_id,
      p_creator: metadata.creator_id,
      p_price: parseInt(metadata.coins),
    })

    if (error || data !== 'ok') {
      return res.status(200).json({ received: true })
    }

    await supabase.from('transactions').insert({
      user_id: metadata.user_id,
      type: 'subscription_payment',
      amount: parseInt(metadata.coins),
      naira_amount: event.data.amount,
      reference,
      status: 'success',
    }).select().maybeSingle()

    return res.status(200).json({ credited: true })
  }

  return res.status(200).json({ received: true })
}