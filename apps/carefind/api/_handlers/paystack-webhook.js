import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getPaystackSecretKey } from '../_lib/paystack.js'
import { creditTopup } from '../_lib/paystackCredit.js'
import { settleConsultationPayment } from '../_lib/consultationSettle.js'

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

  const { data, error } = await supabase.rpc('settle_subscription_payment', {
    p_subscriber: metadata.user_id,
    p_creator: metadata.creator_id,
    p_price: parseInt(metadata.coins),
    p_naira_amount: amount,
    p_reference: reference,
  })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  if (row?.already_processed) return { alreadyProcessed: true }
  return { credited: true }
}

// Transfer handler (automated withdrawal payouts)
async function handleTransferSuccess(reference) {
  // CareFind user withdrawals
  await supabase
    .from('withdrawal_requests')
    .update({ status: 'completed' })
    .eq('paystack_reference', reference)
    .eq('status', 'pending')

  // CareHub business withdrawals
  await supabase
    .from('business_withdrawal_requests')
    .update({ status: 'completed' })
    .eq('paystack_reference', reference)
    .in('status', ['pending', 'processing'])

  return { received: true }
}

async function handleTransferFailed(reference) {
  // CareFind user withdrawals
  const { data: requests } = await supabase
    .from('withdrawal_requests')
    .select('id')
    .eq('paystack_reference', reference)
    .eq('status', 'pending')
    .limit(1)

  if (requests && requests.length > 0) {
    await supabase.rpc('reject_withdrawal_request', { p_request_id: requests[0].id })
  }

  // CareHub business withdrawals
  const { data: bizRequests } = await supabase
    .from('business_withdrawal_requests')
    .select('id')
    .eq('paystack_reference', reference)
    .in('status', ['pending', 'processing'])
    .limit(1)

  if (bizRequests && bizRequests.length > 0) {
    await supabase.rpc('reject_business_withdrawal', { p_request_id: bizRequests[0].id })
  }

  return { received: true }
}

// Consultation handler (CareFind professional consultation booking)
// Races verify-consultation-payment.js on the same reference; the RPC claims
// the reference atomically so only one caller can ever settle the booking.
async function handleConsultation(metadata, reference, amount) {
  if (metadata?.purpose !== 'consultation') return null

  return settleConsultationPayment(supabase, {
    patientId: metadata.user_id,
    professionalId: metadata.professional_id,
    nairaAmount: Math.round(amount / 100),
    reference,
  }).then((result) => ({ settled: true, ...result }))
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
    .select('id, business_id, client_name, booking_type, date, time, fee_amount, payment_status')
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

  return { settled: true }
}

// Shop order handler (CareFind Shop, strict Paystack)
// Races verify-shop-payment on the same order; shop RPC is idempotent.
async function handleShopOrder(metadata, reference, amount) {
  if (!metadata?.order_id) return null

  const { data: order } = await supabase
    .from('shop_orders')
    .select('id, vendor_business_id, total_kobo, payment_status, status, order_ref')
    .eq('id', metadata.order_id)
    .maybeSingle()
  if (!order) return null

  // Cross-check Paystack amount against server total_kobo
  if (order.total_kobo == null || amount !== order.total_kobo) return null

  // Try canonical shop RPCs first
  let result = null
  let error = null
  // New naming: verify_shop_payment / settle_shop_payment
  const tryRpc = async (name, args) => {
    const r = await supabase.rpc(name, args)
    return r
  }
  let rpcRes = await tryRpc('verify_shop_payment', { p_order_id: order.id, p_paystack_reference: reference })
  if (rpcRes.error) {
    // Fallback: settle_shop_payment (older migration)
    rpcRes = await tryRpc('settle_shop_payment', { p_order_id: order.id, p_reference: reference })
  }
  if (rpcRes.error) {
    // Fallback: legacy create_shop_order flow uses shop_payments + status update
    // Do minimal idempotent update if order still pending_payment
    if (order.status === 'pending_payment' || order.payment_status === 'pending') {
      const { error: updErr } = await supabase
        .from('shop_orders')
        .update({ payment_status: 'paid', status: 'paid', paystack_reference: reference })
        .eq('id', order.id)
        .eq('status', 'pending_payment')
      if (updErr) return null
      await supabase.from('shop_order_status_history').insert({
        order_id: order.id,
        from_status: 'pending_payment',
        to_status: 'paid',
        note: `Paystack ${reference}`,
      })
      await supabase.from('shop_payments').upsert({
        order_id: order.id,
        payment_reference: reference,
        amount_kobo: amount,
        status: 'success',
        gateway: 'paystack',
      }, { onConflict: 'payment_reference' })
      result = 'ok'
    } else {
      return null
    }
  } else {
    result = rpcRes.data
    error = rpcRes.error
    if (error) return null
    if (result !== 'ok' && result !== 'already_paid' && result !== 'success' && result !== true) {
      // Some RPCs return boolean true on success
      if (result && typeof result === 'object' && result.already_processed) return { alreadyProcessed: true }
      if (result === 'already_processed') return { alreadyProcessed: true }
      return null
    }
    if (result === 'already_paid' || result === 'already_processed') return { alreadyProcessed: true }
  }

  // Notify vendor business owner (mirror of booking handler)
  await supabase.from('staff_notifications').insert({
    business_id: order.vendor_business_id,
    staff_id: null,
    is_owner: true,
    kind: 'shop_order_paid',
    title: `Shop order paid — ${order.order_ref}`,
    body: `Order ${order.order_ref} — ₦${(amount / 100).toLocaleString()} via Paystack`,
    link: '/dashboard/ecommerce',
    read_at: null,
  })

  return { settled: true }
}

// CareHub plan renewal handler
async function handlePlanPayment(metadata, reference, amount) {
  if (!metadata?.business_id || !metadata?.months) return null

  const months = parseInt(metadata.months)

  const { data, error } = await supabase.rpc('renew_business_plan', {
    p_business_id: metadata.business_id,
    p_months: months,
    p_naira_amount: amount,
    p_reference: reference,
  })
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  if (row.already_processed) return { alreadyProcessed: true }
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

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = JSON.parse(rawBody.toString('utf8'))

  // Dispatch by event type
  if (event.event === 'charge.success') {
    const { reference, metadata, amount } = event.data

    // Try subscription first (has explicit purpose flag)
    let result = await handleSubscription(metadata, reference, amount)
    if (result) return res.status(200).json(result)

    // Try consultation booking (has its own purpose flag)
    result = await handleConsultation(metadata, reference, amount)
    if (result) return res.status(200).json(result)

    // Try CareFind appointment booking (has appointment_id in metadata)
    result = await handleBooking(metadata, reference, amount)
    if (result) return res.status(200).json(result)

    // Try Shop order (has order_id in metadata)
    result = await handleShopOrder(metadata, reference, amount)
    if (result) return res.status(200).json(result)

    // Try CareHub plan payment (has business_id)
    result = await handlePlanPayment(metadata, reference, amount)
    if (result) return res.status(200).json(result)

    // Fall through to top-up (has user_id + coins)
    result = await handleTopup(metadata, reference, amount)
    if (result) return res.status(200).json(result)

    return res.status(200).json({ received: true })
  }

  if (event.event === 'transfer.success') {
    const result = await handleTransferSuccess(event.data.reference)
    return res.status(200).json(result)
  }

  if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    const result = await handleTransferFailed(event.data.reference)
    return res.status(200).json(result)
  }

  return res.status(200).json({ received: true })
}