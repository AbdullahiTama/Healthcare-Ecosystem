import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { paystackFetch } from '../_lib/paystack.js'
import { verifyUser } from '../_lib/verifyUser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Initiate Paystack payment for a shop order.
// Body: { order_id }
// Uses total_kobo server-side; never trusts client amount.
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
  if (!order.total_kobo || order.total_kobo <= 0) {
    return res.status(400).json({ error: 'No amount to pay' })
  }
  // Only pending_payment orders can be paid (strict Paystack)
  if (order.status !== 'pending_payment' && order.status !== 'delivery_quote_pending') {
    return res.status(400).json({ error: `Order status ${order.status} cannot be paid` })
  }

  // Every attempt gets its own Paystack reference, recorded in shop_payments. Before starting another one, the
  // previous attempt is checked with Paystack: if it was actually paid (the customer lost the callback) the
  // client is told to verify it instead of paying twice; otherwise it is closed as failed. A late payment on a
  // closed attempt is still accepted by verify/webhook because the ledger remembers it.
  const { data: pending } = await supabase
    .from('shop_payments')
    .select('id, payment_reference')
    .eq('order_id', order.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  // An order started before attempts were recorded has its reference only on the order.
  const previousRef = pending?.payment_reference || order.payment_reference
  if (previousRef) {
    let check
    try {
      check = await paystackFetch(`/transaction/verify/${encodeURIComponent(previousRef)}`)
    } catch (err) {
      // Cannot tell whether the earlier attempt was paid: starting another could make the customer pay twice.
      return res.status(502).json({ error: 'Could not check your earlier payment. Please try again in a moment.' })
    }
    if (check?.status && check.data?.status === 'success') {
      return res.status(200).json({ alreadyPaid: true, reference: previousRef })
    }
    const closed = pending
      ? await supabase.from('shop_payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', pending.id)
      : await supabase.from('shop_payments').insert({ order_id: order.id, payment_reference: previousRef, amount_kobo: order.total_kobo, status: 'failed', gateway: 'paystack' })
    if (closed.error) return res.status(500).json({ error: 'Could not start payment' })
  }

  const reference = `CF-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  const { error: attemptErr } = await supabase.from('shop_payments').insert({
    order_id: order.id,
    payment_reference: reference,
    amount_kobo: order.total_kobo,
    status: 'pending',
    gateway: 'paystack',
  })
  if (attemptErr) {
    console.error('[initiate-shop-payment] could not record payment attempt:', attemptErr.message)
    return res.status(500).json({ error: 'Could not start payment' })
  }
  const { error: refErr } = await supabase.from('shop_orders').update({ payment_reference: reference }).eq('id', order.id)
  if (refErr) {
    console.error('[initiate-shop-payment] could not save payment reference:', refErr.message)
    return res.status(500).json({ error: 'Could not start payment' })
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || ''
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const origin = host ? `${proto}://${host}` : ''

  try {
    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: user.email || `order+${order.id}@carefind.ng`,
        amount: order.total_kobo,
        reference,
        currency: 'NGN',
        callback_url: `${origin}/orders/${order.id}?reference=${reference}`,
        metadata: { order_id: order.id, vendor_business_id: order.vendor_business_id, type: 'shop_order' },
      }),
    })
    if (!data.status) return res.status(400).json({ error: data.message || 'Could not start payment' })
    return res.status(200).json({
      authorization_url: data.data.authorization_url,
      reference,
      amount: order.total_kobo,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not start payment' })
  }
}
