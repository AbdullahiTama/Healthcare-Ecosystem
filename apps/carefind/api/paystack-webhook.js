import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { creditTopup } from './_lib/paystackCredit.js'

// Was previously at apps/carefind/paystack-webhook.js (project root) — Vercel
// only deploys files under api/ as serverless functions, so that file was
// never actually reachable at a live webhook URL. Moved here so Paystack's
// server-to-server notification has a real endpoint to call. This is now
// the backup confirmation path: verify-payment.js credits immediately when
// the user is redirected back, this webhook credits the same reference if
// that redirect is ever missed (tab closed, network drop) — both call the
// same atomic credit_wallet_topup RPC (see api/_lib/paystackCredit.js),
// so whichever fires first wins and the other is a genuine no-op, not
// just an intended one.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Paystack signs the raw request bytes. Vercel's default body parser would
// have already turned req.body into a JS object by the time the handler
// runs, and JSON.stringify(req.body) is not guaranteed to reproduce those
// exact bytes (key order, number formatting, escaping can all differ) —
// which would make genuine webhooks fail signature verification. Disabling
// the parser and hashing the untouched raw body avoids that.
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
    const { reference, metadata, amount } = event.data

    if (!metadata?.user_id || !metadata?.coins) {
      return res.status(200).json({ received: true })
    }

    const result = await creditTopup(supabase, {
      userId: metadata.user_id,
      coins: parseInt(metadata.coins),
      nairaAmount: amount,
      reference,
    })

    if (result.alreadyProcessed) return res.status(200).json({ already_processed: true })
    return res.status(200).json({ credited: parseInt(metadata.coins), new_balance: result.newBalance })
  }

  return res.status(200).json({ received: true })
}
