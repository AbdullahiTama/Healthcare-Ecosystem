import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// Handles Paystack transfer webhook events. When a transfer succeeds, the
// withdrawal request is marked completed. When it fails, the coins are
// refunded via the existing reject_withdrawal_request RPC.
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

  // Transfer events sent by Paystack
  if (event.event === 'transfer.success') {
    const { reference, recipient } = event.data

    await supabase
      .from('withdrawal_requests')
      .update({ status: 'completed', paystack_transfer_code: event.data.transfer_code || null })
      .eq('paystack_reference', reference)

    return res.status(200).json({ received: true })
  }

  if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    const { reference } = event.data

    // Find the withdrawal request and refund via the existing RPC
    const { data: requests } = await supabase
      .from('withdrawal_requests')
      .select('id')
      .eq('paystack_reference', reference)
      .eq('status', 'pending')
      .limit(1)

    if (requests && requests.length > 0) {
      await supabase.rpc('reject_withdrawal_request', { p_request_id: requests[0].id })
    }

    return res.status(200).json({ received: true })
  }

  return res.status(200).json({ received: true })
}