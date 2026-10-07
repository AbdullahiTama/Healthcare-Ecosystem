import { createClient } from '@supabase/supabase-js'
import { createPaymentIntent, markIntentPending, markIntentFailed, newReference, findIntent } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { runSettlementEffects } from '../_lib/settlementEffects.js'
import { verifyUser } from '../_lib/verifyUser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Initiate Paystack payment for a shop order.
// Body: { order_id }
//
// The amount is the order's own total_kobo, read here on the server and recorded as a payment intent BEFORE Paystack is
// contacted; settlement later accepts only a Paystack payment that matches it (amount, currency, provider) for THIS customer
// and THIS order. Every attempt has its own intent/reference, mirrored in shop_payments (the order's attempt ledger).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Sign in to pay' })

  const { order_id: orderId, orderId: orderIdAlt } = req.body || {}
  const oid = orderId || orderIdAlt
  if (!oid) return res.status(400).json({ error: 'Missing order_id' })

  const { data: order, error: orderErr } = await supabase
    .from('shop_orders')
    .select('id, customer_id, vendor_business_id, total_kobo, subtotal_kobo, payment_reference, paystack_reference, status, payment_status, order_ref')
    .eq('id', oid)
    .maybeSingle()
  if (orderErr || !order) return res.status(404).json({ error: 'Order not found' })
  if (String(order.customer_id) !== String(user.id)) {
    // Vendor trying to pay own order? Forbid.
    return res.status(403).json({ error: 'Not your order' })
  }
  if (order.payment_status === 'paid' || order.status === 'paid') {
    return res.status(400).json({ error: 'Already paid' })
  }
  if (!Number.isSafeInteger(order.total_kobo) || order.total_kobo <= 0) {
    return res.status(400).json({ error: 'No amount to pay' })
  }
  // Only pending_payment orders can be paid (strict Paystack)
  if (order.status !== 'pending_payment' && order.status !== 'delivery_quote_pending') {
    return res.status(400).json({ error: `Order status ${order.status} cannot be paid` })
  }

  const provider = getPaystackProvider()

  // Before starting another attempt, the previous one is checked: if it was actually paid (the customer lost the callback) it is
  // settled now and the client is told, instead of paying twice; otherwise it is closed as failed. A late payment on a closed
  // attempt is still accepted by the redirect verify and the webhook because its intent remembers it.
  const { data: pending } = await supabase
    .from('shop_payments')
    .select('id, payment_reference')
    .eq('order_id', order.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const previousRef = pending?.payment_reference || order.payment_reference
  if (previousRef) {
    const prior = await settleIntentForRequest({ supabase, reference: previousRef, purpose: 'shop_order', user })
    if (prior.outcome === 'settled') {
      await runSettlementEffects(supabase, prior.result)
      return res.status(200).json({ alreadyPaid: true, reference: previousRef })
    }
    if (prior.outcome === 'already_settled') return res.status(200).json({ alreadyPaid: true, reference: previousRef })
    if (prior.outcome === 'error') {
      // Cannot tell whether the earlier attempt was paid: starting another could make the customer pay twice.
      return res.status(502).json({ error: 'Could not check your earlier payment. Please try again in a moment.' })
    }
    if (prior.outcome === 'unknown_reference') {
      // An attempt from before payment intents existed: it cannot be settled by the engine. If Paystack says it was paid, do NOT
      // take a second payment; it needs a human.
      let check
      try {
        check = await provider.verifyPayment({ reference: previousRef })
      } catch (err) {
        // A reference Paystack never saw can never be paid: the earlier attempt
        // is definitively unpaid, so fall through and close it instead of
        // wedging this order behind a 502 that can never succeed.
        if (err?.code === 'not_found') check = { status: 'not_found' }
        else return res.status(502).json({ error: 'Could not check your earlier payment. Please try again in a moment.' })
      }
      if (check?.status === 'success') {
        paymentLogger.error('payment.shop.legacy_attempt_paid', { order: order.id, reference: previousRef })
        return res.status(409).json({ error: 'An earlier payment for this order is being reviewed. Please contact support before paying again.' })
      }
    }

    // not paid / could not be applied / legacy and unpaid: close the previous attempt (its intent too, if it has one)
    const closed = pending
      ? await supabase.from('shop_payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', pending.id)
      : await supabase.from('shop_payments').insert({ order_id: order.id, payment_reference: previousRef, amount_kobo: order.total_kobo, status: 'failed', gateway: 'paystack' })
    if (closed.error) return res.status(500).json({ error: 'Could not start payment' })
    try {
      const priorIntent = await findIntent(supabase, previousRef)
      if (priorIntent && ['created', 'pending'].includes(priorIntent.status)) await markIntentFailed(supabase, priorIntent.id)
    } catch (err) {
      paymentLogger.warn('payment.shop.close_previous_intent_failed', { reference: previousRef, message: err.message })
    }
  }

  const reference = newReference('cf_shop', order.id)
  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carefind',
      purpose: 'shop_order',
      customerId: user.id,
      businessId: order.vendor_business_id,
      entityType: 'shop_order',
      entityId: order.id,
      expectedAmountKobo: order.total_kobo,
      metadata: { order_ref: order.order_ref },
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'shop_order', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  const { error: attemptErr } = await supabase.from('shop_payments').insert({
    order_id: order.id,
    payment_reference: reference,
    amount_kobo: order.total_kobo,
    status: 'pending',
    gateway: 'paystack',
  })
  if (attemptErr) {
    console.error('[initiate-shop-payment] could not record payment attempt:', attemptErr.message)
    await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(500).json({ error: 'Could not start payment' })
  }
  const { error: refErr } = await supabase.from('shop_orders').update({ payment_reference: reference }).eq('id', order.id)
  if (refErr) {
    console.error('[initiate-shop-payment] could not save payment reference:', refErr.message)
    await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(500).json({ error: 'Could not start payment' })
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || ''
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const origin = host ? `${proto}://${host}` : ''

  try {
    const init = await provider.initializePayment({
      email: user.email || `order+${order.id}@carefind.ng`,
      amountKobo: intent.expected_amount,
      reference,
      callbackUrl: `${origin}/orders/${order.id}?reference=${reference}`,
      metadata: { intent_id: intent.id, purpose: 'shop_order', order_id: order.id },
    })
    await markIntentPending(supabase, intent.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference, amount: order.total_kobo })
  } catch (err) {
    // A definite refusal closes the intent; an ambiguous failure leaves it open to expire (the customer was never sent a checkout link).
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
