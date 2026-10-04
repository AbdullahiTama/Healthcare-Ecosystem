import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getPaystackSecretKey } from '../_lib/paystack.js'
import { settleByReference, recordProviderEvent, finishProviderEvent, paystackEventId, settleTransferWebhook } from '@care-ecosystem/shared-payments'
import { applyWithdrawalResult } from '../_lib/withdrawalEffects.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'
import { creditTopup } from '../_lib/paystackCredit.js'
import { settleConsultationPayment } from '../_lib/consultationSettle.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'

// Single Paystack webhook for all apps — register this URL in the Paystack
// dashboard. Dispatches by event metadata: top-ups, subscriptions, transfers,
// and CareHub plan payments all route through here.
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

// Top-up handler (CareFind wallet credit)
async function handleTopup(metadata, reference, amount) {
  if (!metadata?.user_id || !metadata?.coins) return null
  return creditTopup(supabase, {
    userId: metadata.user_id,
    coins: parseInt(metadata.coins),
    nairaAmount: amount,
    reference,
  })
}

// Subscription handler (CareFind Paystack card payment)
async function handleSubscription(metadata, reference, amount) {
  if (metadata?.purpose !== 'subscription') return null
  const subCoins = Number(metadata.coins)
  if (!Number.isInteger(subCoins) || subCoins > 12 || subCoins <= 0) return null

  const { data, error } = await supabase.rpc('settle_subscription_payment', {
    p_subscriber: metadata.user_id,
    p_creator: metadata.creator_id,
    p_price: parseInt(metadata.coins),
    // Paystack reports kobo; transactions.naira_amount is NAIRA everywhere else (top-ups, consultations, bookings).
    p_naira_amount: Math.round(amount / 100),
    p_reference: reference,
  })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  if (row?.already_processed) return { alreadyProcessed: true }

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
    if (metadata.user_id) {
      const { data: subUser } = await supabase.auth.admin.getUserById(metadata.user_id)
      const subscriberEmail = subUser?.user?.email
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      if (subscriberEmail) {
        await enqueueOutbox({
          templateKey: 'subscription_created',
          toEmail: subscriberEmail,
          idempotencyKey: `subscription-started:${reference}`,
          payload: {
            fullName: subscriber?.full_name || 'There',
            plan: `${parseInt(metadata.coins)} CareCoins`,
            businessName: creator?.display_name || creator?.full_name || 'Creator',
            expiryDate: expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          },
          subject: `You're subscribed — ${creator?.display_name || 'your subscription'} is active`,
        })
        flushOutbox().catch((err) => {
          console.error('[paystack-webhook] subscription flush error:', err)
        })
      }
    }
  } catch (err) {
    console.error('[paystack-webhook] subscription email error:', err)
  }

  return { credited: true }
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

// Consultation handler (CareFind professional consultation booking)
// Races verify-consultation-payment.js on the same reference; the RPC claims
// the reference atomically so only one caller can ever settle the booking.
async function handleConsultation(metadata, reference, amount) {
  if (metadata?.purpose !== 'consultation') return null

  const result = await settleConsultationPayment(supabase, {
    patientId: metadata.user_id,
    professionalId: metadata.professional_id,
    nairaAmount: Math.round(amount / 100),
    reference,
  })

  try {
    const { data: authData } = await supabase.auth.admin.getUserById(metadata.user_id)
    const email = authData?.user?.email
    if (email) {
      await enqueueOutbox({
        templateKey: 'consultation_confirmed',
        toEmail: email,
        payload: { fullName: authData.user.user_metadata?.full_name || email, service: 'Consultation' },
        subject: 'Your CareFind consultation is confirmed',
        idempotencyKey: `consultation-confirmed:${reference}`,
      })
      flushOutbox().catch((err) => console.error('[paystack-webhook] consultation flush error:', err))
    }
  } catch (err) {
    console.error('[paystack-webhook] consultation email error:', err)
  }

  return { settled: true, ...result }
}

// Booking handler (CareFind business-profile appointment, card paid)
// Races verify-booking-payment.js on the same appointment; settle_card_booking
// is SECURITY DEFINER and idempotent (returns 'already_paid' for a repeat), so
// whichever caller arrives first settles, and the other is a safe no-op. This
// is the async backup for clients who pay but abandon the Paystack return URL.
async function handleBooking(metadata, reference, amount) {
  if (!metadata?.appointment_id) return null

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, business_id, client_name, booking_type, date, time, fee_amount, payment_status, client_email, service, source')
    .eq('id', metadata.appointment_id)
    .maybeSingle()
  if (!appt) return null

  // Cross-check the Paystack amount against the stored fee before settling.
  if (appt.fee_amount == null || amount !== appt.fee_amount) return null

  const { data: result, error } = await supabase.rpc('settle_card_booking', {
    p_appointment_id: appt.id,
    p_reference: reference,
  })
  if (error) return null
  if (result !== 'ok' && result !== 'already_paid') return null
  if (result === 'already_paid') return { alreadyProcessed: true }

  // Notify the business that payment landed (mirror of verify-booking-payment.js).
  await supabase.from('staff_notifications').insert({
    business_id: appt.business_id,
    staff_id: null,
    is_owner: true,
    kind: 'booking_paid',
    title: `Payment received — ${appt.client_name}`,
    body: `${appt.date} at ${appt.time} — ₦${(appt.fee_amount / 100).toLocaleString()}`,
    link: '/dashboard/appointments',
    read_at: null,
  })

  // Booking confirmation email to the client — enqueue + flush. CareHub
  // appointments use the carehub appointment template; CareFind bookings use
  // booking_confirmed. Only the first settler (webhook vs verify redirect)
  // sends — the other sees 'already_paid' and returns above.
  if (appt.client_email && appt.client_email.includes('@')) {
    try {
      const { data: business } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', appt.business_id)
        .maybeSingle()
      const isCareHub = appt.source === 'carehub'
      await enqueueOutbox({
        templateKey: isCareHub ? 'appointment_confirmed' : 'booking_confirmed',
        toEmail: appt.client_email,
        sourceId: appt.id,
        idempotencyKey: `${isCareHub ? 'appointment-confirmed' : 'booking-confirmed'}:${appt.id}`,
        payload: {
          fullName: appt.client_name,
          businessName: business?.name || '',
          service: appt.service || 'Consultation',
          date: appt.date,
          time: appt.time,
          ...(isCareHub ? { staffName: '' } : {}),
        },
        subject: isCareHub ? 'Your appointment is confirmed' : 'Your booking is confirmed',
      })
      flushOutbox().catch((err) => {
        console.error('[paystack-webhook] booking confirmation flush error:', err)
      })
    } catch (err) {
      console.error('[paystack-webhook] booking confirmation email error:', err)
    }
  }

  return { settled: true }
}

// Shop order handler (CareFind Shop, strict Paystack)
// Races verify-shop-payment on the same order; shop RPC is idempotent.
// Uses claim_payment_event for deduplication to prevent double-processing.
async function handleShopOrder(metadata, reference, amount) {
  if (!metadata?.order_id) return null

  const { data: order } = await supabase
    .from('shop_orders')
    .select('id, vendor_business_id, total_kobo, payment_reference, paystack_reference, payment_status, status, order_ref')
    .eq('id', metadata.order_id)
    .maybeSingle()
  if (!order) return null

  // Cross-check Paystack amount against server total_kobo. A mismatch can never be fixed by a retry, so it
  // is logged and acknowledged (a 500 would make Paystack redeliver it forever).
  if (order.total_kobo == null || amount !== order.total_kobo) {
    console.error('[paystack-webhook] shop order amount mismatch', { orderId: order.id, reference, paid: amount, expected: order.total_kobo })
    return { rejected: true }
  }

  // The reference must be an attempt of THIS order: the latest one is the order's payment_reference, earlier
  // ones (a retried payment) are recorded in shop_payments.
  if (reference !== order.payment_reference) {
    const { data: attempt } = await supabase
      .from('shop_payments').select('id').eq('order_id', order.id).eq('payment_reference', reference).maybeSingle()
    if (!attempt) {
      console.error('[paystack-webhook] shop payment reference is not an attempt of the order', { orderId: order.id, reference })
      return { rejected: true }
    }
  }

  // Deduplicate via shop_payment_events. The claim is recorded BEFORE settlement, so "already claimed" only
  // means this delivery is a duplicate if the order really is paid; otherwise an earlier delivery claimed it
  // and then failed, and this redelivery must settle it (every settle path below is idempotent).
  const { data: claimed } = await supabase.rpc('claim_payment_event', {
    p_order_id: order.id,
    p_payment_reference: reference,
    p_event_type: 'charge.success',
    p_amount_kobo: amount,
  })
  const alreadyPaid = order.payment_status === 'paid' || order.status === 'paid'
  if (claimed === 'already_processed' && alreadyPaid) return { alreadyProcessed: true }

  // A different attempt succeeded on an order that is already paid: the customer has paid twice. Record it so
  // it can be refunded - never settle again and never drop it.
  if (alreadyPaid && order.paystack_reference && order.paystack_reference !== reference) {
    await recordDuplicatePayment(order, reference, amount)
    return { alreadyProcessed: true }
  }

  // Try canonical shop RPCs
  let rpcRes = await supabase.rpc('verify_shop_payment', { p_order_id: order.id, p_paystack_reference: reference })
  if (rpcRes.error) {
    rpcRes = await supabase.rpc('settle_shop_payment', { p_order_id: order.id, p_reference: reference })
  }
  if (rpcRes.error) {
    // Fallback: direct idempotent update if order still pending_payment
    if (order.status === 'pending_payment' || order.payment_status === 'pending') {
      const { data: updRows, error: updErr } = await supabase
        .from('shop_orders')
        .update({ payment_status: 'paid', status: 'paid', paystack_reference: reference })
        .eq('id', order.id)
        .eq('status', 'pending_payment')
        .select('id')
      if (updErr) throw new Error(`shop order ${order.id} settlement failed: ${updErr.message}`)
      // The guarded UPDATE matched nothing: another path settled the order first. Stop here so the
      // history row, payment row and notifications are not written a second time.
      if (!updRows || updRows.length === 0) return { alreadyProcessed: true }
      await supabase.from('shop_order_status_history').insert({
        order_id: order.id, from_status: 'pending_payment', to_status: 'paid',
        note: `Paystack ${reference}`,
      })
      await supabase.from('shop_payments').upsert({
        order_id: order.id, payment_reference: reference, amount_kobo: amount,
        status: 'success', gateway: 'paystack',
      }, { onConflict: 'payment_reference' })
    } else {
      throw new Error(`shop order ${order.id} could not be settled: ${rpcRes.error.message}`)
    }
  } else {
    const result = rpcRes.data
    if (result === 'already_paid' || result === 'already_processed') return { alreadyProcessed: true }
    if (result && typeof result === 'object' && result.already_processed) return { alreadyProcessed: true }
    // Anything else means the order was not settled; throw so the handler answers 500 and Paystack redelivers.
    if (result !== 'ok' && result !== 'success' && result !== true) throw new Error(`shop order ${order.id} settle returned "${result}"`)
  }

  // Notify vendor business owner
  await supabase.from('staff_notifications').insert({
    business_id: order.vendor_business_id, staff_id: null, is_owner: true,
    kind: 'shop_order_paid',
    title: `Shop order paid — ${order.order_ref}`,
    body: `Order ${order.order_ref} — ₦${(amount / 100).toLocaleString()} via Paystack`,
    link: '/dashboard/ecommerce', read_at: null,
  })

  // Notify customer (email + in-app) — fire-and-forget
  notifyCustomerPostPayment(order.id).catch(err => {
    console.error('[paystack-webhook] customer notification error:', err)
  })

  return { settled: true }
}

// A second successful payment for an order that was already settled. The ledger row (gateway_response.duplicate)
// is the queryable refund worklist; the vendor is notified and the log line is tagged for alerting. Throws on a
// write failure so the webhook answers 500 and Paystack redelivers - losing this record would lose track of money.
async function recordDuplicatePayment(order, reference, amount) {
  console.error('[shop-duplicate-payment] refund needed', { orderId: order.id, orderRef: order.order_ref, reference, settledWith: order.paystack_reference, amount })
  const { error: ledgerErr } = await supabase.from('shop_payments').upsert({
    order_id: order.id, payment_reference: reference, amount_kobo: amount, status: 'success', gateway: 'paystack',
    gateway_response: { duplicate: true, settled_reference: order.paystack_reference },
  }, { onConflict: 'payment_reference' })
  if (ledgerErr) throw new Error(`could not record duplicate payment ${reference}: ${ledgerErr.message}`)
  await supabase.from('staff_notifications').insert({
    business_id: order.vendor_business_id, staff_id: null, is_owner: true,
    kind: 'shop_duplicate_payment',
    title: `Duplicate payment — ${order.order_ref}`,
    body: `Order ${order.order_ref} was paid twice (₦${(amount / 100).toLocaleString()} extra, ref ${reference}). CareFind will refund the duplicate.`,
    link: '/dashboard/ecommerce', read_at: null,
  }).then(() => {}, () => {})
}

async function notifyCustomerPostPayment(orderId) {
  const { data: fullOrder } = await supabase
    .from('shop_orders')
    .select('id, order_ref, customer_id, total_kobo, fulfilment_kobo, delivery_kobo, subtotal_kobo, delivery_address, delivery_city, delivery_state, delivery_email, customer_name, payment_reference, created_at')
    .eq('id', orderId)
    .maybeSingle()
  if (!fullOrder) return

  const { data: items } = await supabase
    .from('shop_order_items')
    .select('product_name, quantity, unit_price_kobo')
    .eq('order_id', orderId)

  // In-app notification
  if (fullOrder.customer_id) {
    await supabase.from('notifications').insert({
      recipient_id: fullOrder.customer_id,
      type: 'shop_order_paid',
      message: `Payment confirmed for order ${fullOrder.order_ref} — ₦${(fullOrder.total_kobo / 100).toLocaleString()}`,
      link: `/orders/${orderId}`,
    }).then(() => {}, () => {})
  }

  // Order confirmation email (templated, via outbox) — enqueue + immediate flush
  const email = fullOrder.delivery_email
  if (email && email.includes('@')) {
    try {
      await enqueueOutbox({
        templateKey: 'order_confirmation',
        toEmail: email,
        idempotencyKey: `order-confirmation:${fullOrder.id}`,
        payload: {
          fullName: fullOrder.customer_name || 'Valued Customer',
          orderRef: fullOrder.order_ref,
          items: (items || []).map((it) => ({
            name: it.product_name,
            quantity: it.quantity,
            price: Math.round((it.unit_price_kobo || 0) / 100),
          })),
          totalNaira: Math.round((fullOrder.total_kobo || 0) / 100),
          businessName: 'CareFind',
          deliveryAddress: fullOrder.delivery_address || '',
        },
        subject: `Order Confirmed — ${fullOrder.order_ref}`,
      })
      flushOutbox().catch((err) => {
        console.error('[paystack-webhook] outbox flush error:', err)
      })
    } catch (err) {
      console.error('[paystack-webhook] order confirmation enqueue error:', err)
    }
  }
}

// CareHub plan renewal handler
async function handlePlanPayment(metadata, reference, amount) {
  if (!metadata?.business_id || !metadata?.months) return null

  const months = parseInt(metadata.months)

  const { data, error } = await supabase.rpc('renew_business_plan', {
    p_business_id: metadata.business_id,
    p_months: months,
    // Paystack reports kobo; plan_payments.naira_amount is NAIRA (it used to store kobo, which
    // overstated revenue 100x in every report that read it as naira).
    p_naira_amount: Math.round(amount / 100),
    p_reference: reference,
  })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  if (row.already_processed) return { alreadyProcessed: true }

  // Subscription created email to the business owner — enqueue + flush.
  try {
    const { data: biz } = await supabase
      .from('businesses')
      .select('name, plan, plan_expires_at, owner_name, owner_email, email')
      .eq('id', metadata.business_id)
      .maybeSingle()
    const ownerEmail = biz?.owner_email || biz?.email
    if (biz && ownerEmail) {
      await enqueueOutbox({
        templateKey: 'subscription_created',
        toEmail: ownerEmail,
        idempotencyKey: `subscription-started:${reference}`,
        payload: {
          fullName: biz.owner_name || 'Business Owner',
          plan: biz.plan || 'Standard',
          businessName: biz.name,
          expiryDate: biz.plan_expires_at ? new Date(biz.plan_expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        },
        subject: 'Your CareHub subscription is active',
      })
      flushOutbox().catch((err) => {
        console.error('[paystack-webhook] subscription flush error:', err)
      })
    }
  } catch (err) {
    console.error('[paystack-webhook] subscription email error:', err)
  }

  return { credited: true, new_expiry: row.new_expiry }
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

// Settlement of a gateway payment that has a payment intent. Returns null when the reference is not an
// intent (a payment started before the settlement engine existed), so the caller falls back to the
// legacy metadata dispatch below.
async function settleIntentPayment(reference) {
  const result = await settleByReference({ supabase, provider: getPaystackProvider(), reference, logger: paymentLogger })
  if (result.outcome === 'unknown_reference') return null
  if (result.outcome === 'not_paid' || result.outcome === 'rejected') {
    // Paystack says charge.success but the verify call disagrees (or the engine refused): do not
    // acknowledge, so Paystack redelivers and the state is re-examined.
    throw new Error(`intent ${reference} not settled: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`)
  }
  if (result.outcome === 'needs_refund') {
    // Money received that could not be applied. Never dropped: the intent is parked as needs_refund.
    console.error('[payment-needs-refund]', { reference, purpose: result.purpose, reason: result.reason })
  }
  await runSettlementEffects(supabase, result) // only the call that actually settled sends emails/notices
  return result
}

// -> 'processed' | 'ignored'
async function processWebhookEvent(event) {
  // Dispatch by event type
  if (event.event === 'charge.success') {
    const { reference, metadata, amount } = event.data

    // Payments that went through the settlement engine: one path, shared with the redirect handlers.
    if (reference && await settleIntentPayment(reference)) return 'processed'

    // Legacy dispatch (payments started before the engine): by metadata shape.
    // Try subscription first (has explicit purpose flag)
    let result = await handleSubscription(metadata, reference, amount)
    if (result) return 'processed'

    // Try consultation booking (has its own purpose flag)
    result = await handleConsultation(metadata, reference, amount)
    if (result) return 'processed'

    // Try CareFind appointment booking (has appointment_id in metadata)
    result = await handleBooking(metadata, reference, amount)
    if (result) return 'processed'

    // Try Shop order (has order_id in metadata)
    result = await handleShopOrder(metadata, reference, amount)
    if (result) return 'processed'

    // Try CareHub plan payment (has business_id)
    result = await handlePlanPayment(metadata, reference, amount)
    if (result) return 'processed'

    // Fall through to top-up (has user_id + coins)
    result = await handleTopup(metadata, reference, amount)
    if (result) return 'processed'
    return 'ignored'
  }

  if (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    await handleTransferEvent(event)
    return 'processed'
  }
  return 'ignored'
}
