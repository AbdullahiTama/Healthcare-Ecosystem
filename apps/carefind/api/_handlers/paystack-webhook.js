import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getPaystackSecretKey } from '../_lib/paystack.js'
import { settleByReference, recordProviderEvent, finishProviderEvent, paystackEventId, settleTransferWebhook, settleRefundWebhook } from '@care-ecosystem/shared-payments'
import { applyWithdrawalResult } from '../_lib/withdrawalEffects.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'

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

// Transfer webhooks (automated withdrawal payouts). The DATABASE settles them (settle_withdrawal /
// settle_business_withdrawal: replay-safe, refunds at most once, completes only for the amount reserved, and a
// reversal of an already-completed transfer is refunded); this only maps the event to an outcome and runs the
// side effects (trust tier, email) for a change THIS delivery made. An RPC error throws, so the event is
// recorded as failed and Paystack's retry settles it.
async function handleTransferEvent(event) {
  const settled = await settleTransferWebhook(supabase, event, { logger: paymentLogger })
  if (settled.kind === 'carefind') await applyWithdrawalResult(supabase, settled.outcome, settled.result)
  return { received: true }
}

// Refund webhooks (refund.pending / processing / processed / failed). The DATABASE settles them (settle_refund: replay-safe,
// completes only for the refunded amount, a failure restores the business exactly, contradictions are reported). An RPC
// error throws so the event is recorded as failed and Paystack's retry settles it.
async function handleRefundEvent(event) {
  await settleRefundWebhook(supabase, event, { logger: paymentLogger })
  return { received: true }
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
    const outcome = await processWebhookEvent(event)
    if (recorded) await finishProviderEvent(supabase, recorded.event, { outcome })
  } catch (err) {
    console.error('[paystack-webhook] processing error:', err)
    if (recorded) await finishProviderEvent(supabase, recorded.event, { outcome: 'failed', error: err.message }).catch(() => {})
    return res.status(500).json({ error: 'Processing failed' })
  }
  return res.status(200).json({ received: true })
}

// Settlement of a gateway payment. Every payment now has a payment intent (recorded before checkout), so this is the only
// settlement path. -> the engine's answer, or null when the reference is not ours / not an intent.
async function settleIntentPayment(reference) {
  const result = await settleByReference({ supabase, provider: getPaystackProvider(), reference, logger: paymentLogger })
  if (result.outcome === 'unknown_reference') return null
  if (result.outcome === 'not_paid' || result.outcome === 'rejected') {
    // Paystack says charge.success but the verify call disagrees (or the engine refused): do not
    // acknowledge, so Paystack redelivers and the state is re-examined.
    throw new Error(`intent ${reference} not settled: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`)
  }
  if (result.outcome === 'needs_refund') {
    // Money received that could not be applied. Never dropped: the intent is parked as needs_refund and the refund engine
    // (cron) refunds it.
    console.error('[payment-needs-refund]', { reference, purpose: result.purpose, reason: result.reason })
  }
  await runSettlementEffects(supabase, result) // only the call that actually settled sends emails/notices
  return result
}

// -> 'processed' | 'ignored'
async function processWebhookEvent(event) {
  // Dispatch by event type
  if (event.event === 'charge.success') {
    const reference = event.data?.reference
    if (reference && await settleIntentPayment(reference)) return 'processed'
    // A successful charge that no payment intent recognises: not one of ours (another Paystack integration on the same account),
    // or a payment started before payment intents existed. It is acknowledged (a retry cannot change it) but logged LOUDLY so
    // reconciliation / an operator sees real money that nothing settled. NEVER guessed from its metadata.
    paymentLogger.error('payment.unmatched_charge', { reference: reference || null, amount: event.data?.amount ?? null, currency: event.data?.currency ?? null })
    return 'ignored'
  }

  if (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await handleTransferEvent(event)
    return 'processed'
  }

  if (event.event === 'refund.processed' || event.event === 'refund.failed' || event.event === 'refund.pending' || event.event === 'refund.processing') {
    await handleRefundEvent(event)
    return 'processed'
  }
  return 'ignored'
}
