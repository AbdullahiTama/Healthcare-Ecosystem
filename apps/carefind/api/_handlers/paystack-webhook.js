import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getPaystackSecretKey } from '../_lib/paystack.js'
import { recordProviderEvent, finishProviderEvent, paystackEventId } from '@care-ecosystem/shared-payments'
import { paymentLogger } from '../_lib/payments.js'
import { processWebhookEvent } from '../_lib/webhookProcessor.js'

// Single Paystack webhook for all apps - register this URL in the Paystack dashboard.
//   charge.success   -> the ONE settlement engine (settle_payment_intent). The event decides nothing: the payment intent recorded
//                       before checkout names the purpose, the payer, the payee and the amount, and Paystack is asked directly.
//   transfer.*       -> the withdrawal engine
//   refund.*         -> the refund engine
// Nothing dispatches on the event's `metadata` any more: that is client-influenced data.
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
  let secretKey
  try {
    secretKey = getPaystackSecretKey()
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex')

  // Constant-time comparison: a plain !== leaks, byte by byte, how much of a guessed signature matched.
  const received = Buffer.from(String(req.headers['x-paystack-signature'] || ''))
  const expected = Buffer.from(hash)
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    // A forged or mis-keyed call: nothing is stored or processed, but an operator should be able to see it happening.
    paymentLogger.warn('webhook.invalid_signature', { hasSignature: Boolean(req.headers['x-paystack-signature']), bytes: rawBody.length })
    return res.status(401).json({ error: 'Invalid signature' })
  }

  let event
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    // Signed but not JSON: nothing a retry could fix.
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  // Persist the event BEFORE processing: a replayed event that was already handled is acknowledged
  // without reprocessing; one whose earlier attempt failed is processed again (retry-safe).
  let recorded = null
  const eventId = paystackEventId(event)
  if (eventId) {
    try {
      recorded = await recordProviderEvent(supabase, {
        provider: 'paystack',
        eventId,
        eventType: event.event,
        reference: event.data?.reference ?? null,
        payload: event,
        signatureOk: true,
      })
    } catch (err) {
      console.error('[paystack-webhook] could not persist event:', err)
      return res.status(500).json({ error: 'Processing failed' })
    }
    if (recorded.alreadyHandled) return res.status(200).json({ received: true, duplicate: true })
  }

  // Settle BEFORE acknowledging. Vercel can freeze a serverless function as soon as the
  // response is sent, so work done after res.json() may never run - and Paystack, having
  // been told 200, would never redeliver. Every handler is idempotent (claim-first RPCs,
  // unique references), so a failure answers 500 and Paystack retries the event.
  try {
    const outcome = await processWebhookEvent(supabase, event)
    if (recorded) await finishProviderEvent(supabase, recorded.event, { outcome })
  } catch (err) {
    console.error('[paystack-webhook] processing error:', err)
    if (recorded) await finishProviderEvent(supabase, recorded.event, { outcome: 'failed', error: err.message }).catch(() => {})
    return res.status(500).json({ error: 'Processing failed' })
  }
  return res.status(200).json({ received: true })
}

