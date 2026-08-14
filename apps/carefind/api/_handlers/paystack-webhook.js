import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getPaystackSecretKey } from '../_lib/paystack.js'
import { creditTopup } from '../_lib/paystackCredit.js'
import { settleConsultationPayment } from '../_lib/consultationSettle.js'

// Single Paystack webhook for all apps ΓÇö register this URL in the Paystack
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

// ΓöÇΓöÇ Top-up handler (CareFind wallet credit) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function handleTopup(metadata, reference, amount) {
  if (!metadata?.user_id || !metadata?.coins) return null
  return creditTopup(supabase, {
    userId: metadata.user_id,
    coins: parseInt(metadata.coins),
    nairaAmount: amount,
    reference,
  })
}

// ΓöÇΓöÇ Subscription handler (CareFind Paystack card payment) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function handleSubscription(metadata, reference, amount) {
  if (metadata?.purpose !== 'subscription') return null

  const { data: existing } = await supabase
    .from('transactions').select('id')
    .eq('reference', reference).eq('type', 'subscription_payment')
    .maybeSingle()
  if (existing) return { alreadyProcessed: true }

  const { data, error } = await supabase.rpc('pay_creator_subscription', {
    p_subscriber: metadata.user_id,
    p_creator: metadata.creator_id,
    p_price: parseInt(metadata.coins),
  })
  if (error || data !== 'ok') return null

  await supabase.from('transactions').insert({
    user_id: metadata.user_id,
    type: 'subscription_payment',
    amount: parseInt(metadata.coins),
    naira_amount: amount,
    reference,
    status: 'success',
  }).select().maybeSingle()

  return { credited: true }
}

// ΓöÇΓöÇ Transfer handler (automated withdrawal payouts) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function handleTransferSuccess(reference) {
  await supabase
    .from('withdrawal_requests')
    .update({ status: 'completed' })
    .eq('paystack_reference', reference)
    .eq('status', 'pending')
  return { received: true }
}

async function handleTransferFailed(reference) {
  const { data: requests } = await supabase
    .from('withdrawal_requests')
    .select('id')
    .eq('paystack_reference', reference)
    .eq('status', 'pending')
    .limit(1)

  if (requests && requests.length > 0) {
    await supabase.rpc('reject_withdrawal_request', { p_request_id: requests[0].id })
  }
  return { received: true }
}

// ΓöÇΓöÇ Consultation handler (CareFind professional consultation booking) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

// ΓöÇΓöÇ CareHub plan renewal handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// ── Booking handler (CareFind business-profile appointment, card paid) ──
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

async function handlePlanPayment(metadata, reference, amount) {
  if (!metadata?.business_id || !metadata?.months) return null

  const { data: existing } = await supabase
    .from('plan_payments').select('id')
    .eq('reference', reference)
    .maybeSingle()
  if (existing) return { alreadyProcessed: true }

  const { data: business } = await supabase
    .from('businesses').select('id, plan_expires_at')
    .eq('id', metadata.business_id)
    .maybeSingle()
  if (!business) return null

  const months = parseInt(metadata.months)
  const base = business.plan_expires_at && new Date(business.plan_expires_at) > new Date()
    ? new Date(business.plan_expires_at) : new Date()
  const newExpiry = new Date(base)
  newExpiry.setMonth(newExpiry.getMonth() + months)

  await supabase.from('businesses').update({ plan_expires_at: newExpiry.toISOString() }).eq('id', business.id)
  await supabase.from('plan_payments').insert({
    business_id: business.id, months, naira_amount: amount, reference, status: 'success',
  })
  return { credited: true, new_expiry: newExpiry.toISOString() }
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
