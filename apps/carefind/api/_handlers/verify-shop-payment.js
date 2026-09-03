import { createClient } from '@supabase/supabase-js'
import { paystackFetch } from '../_lib/paystack.js'
import { verifyUser } from '../_lib/verifyUser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Verifies a Paystack payment for a shop order and marks it paid.
// Body: { order_id, reference }
// Verifies amount server-side before settling; races webhook idempotently.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  // Allow verified user or unauthenticated redirect path; but we still verify ownership via order id
  // If verifyUser fails we fall back to reference-only lookup (callback path) — still safe because amount is checked
  const { order_id: orderId, reference } = req.body || {}
  if (!reference && !orderId) return res.status(400).json({ error: 'Missing order_id or reference' })

  // Find order by reference first (client is allowed to supply only reference)
  let order = null
  if (reference) {
    const { data } = await supabase
      .from('shop_orders')
      .select('id, customer_id, vendor_business_id, total_kobo, payment_reference, paystack_reference, status, payment_status, order_ref')
      .eq('payment_reference', reference)
      .maybeSingle()
    if (data) order = data
  }
  if (!order && orderId) {
    const { data } = await supabase.from('shop_orders').select('id, customer_id, vendor_business_id, total_kobo, payment_reference, paystack_reference, status, payment_status, order_ref').eq('id', orderId).maybeSingle()
    if (data) order = data
  }
  if (!order) return res.status(404).json({ error: 'Order not found for this reference' })

  // If user is present, enforce ownership
  if (user && String(order.customer_id) !== String(user.id)) {
    // Vendor or other user — still allow verify but don't leak?
    // Keep strict: only owner or service role via webhook may verify.
    // However for redirect flow the customer is the payer, so enforce.
    return res.status(403).json({ error: 'Not your order' })
  }

  if (order.payment_status === 'paid' || order.status === 'paid') {
    return res.status(200).json({ success: true, id: order.id, alreadyPaid: true })
  }

  const paystackRef = reference || order.payment_reference || order.paystack_reference
  if (!paystackRef) return res.status(400).json({ error: 'No payment reference' })

  let paystackData
  try {
    paystackData = await paystackFetch(`/transaction/verify/${encodeURIComponent(paystackRef)}`)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not verify payment' })
  }
  if (!paystackData.status || paystackData.data?.status !== 'success') {
    return res.status(400).json({ error: 'Payment not confirmed by Paystack' })
  }

  const verifiedAmount = paystackData.data.amount
  if (verifiedAmount !== order.total_kobo) {
    return res.status(400).json({ error: 'Payment amount does not match order total' })
  }

  // Try RPC settle paths — prefer verify_shop_payment, fallback to settle_shop_payment, then direct update
  let settled = false
  let alreadyPaid = false
  const tryRpc = async (name, args) => supabase.rpc(name, args)

  let rpc = await tryRpc('verify_shop_payment', { p_order_id: order.id, p_paystack_reference: paystackRef })
  if (!rpc.error) {
    const v = rpc.data
    if (v === 'ok' || v === 'success' || v === true) settled = true
    else if (v === 'already_paid' || v === 'already_processed') alreadyPaid = true
    else if (v && typeof v === 'object' && v.already_processed) alreadyPaid = true
  } else {
    rpc = await tryRpc('settle_shop_payment', { p_order_id: order.id, p_reference: paystackRef })
    if (!rpc.error) {
      const v = rpc.data
      if (v === 'ok' || v === 'success' || v === true) settled = true
      else if (v === 'already_paid') alreadyPaid = true
    } else {
      // Fallback direct update (idempotent)
      const { error: updErr } = await supabase
        .from('shop_orders')
        .update({ payment_status: 'paid', status: 'paid', paystack_reference: paystackRef })
        .eq('id', order.id)
        .eq('status', 'pending_payment')
      if (!updErr) {
        await supabase.from('shop_order_status_history').insert({
          order_id: order.id,
          from_status: 'pending_payment',
          to_status: 'paid',
          note: `Paystack ${paystackRef}`,
        })
        await supabase.from('shop_payments').upsert({
          order_id: order.id,
          payment_reference: paystackRef,
          amount_kobo: verifiedAmount,
          status: 'success',
          gateway: 'paystack',
          gateway_response: paystackData.data,
        }, { onConflict: 'payment_reference' })
        settled = true
      } else if (String(updErr.message).includes('duplicate') || String(updErr.code) === '23505') {
        alreadyPaid = true
      } else {
        return res.status(500).json({ error: updErr.message })
      }
    }
  }

  if (alreadyPaid) return res.status(200).json({ success: true, id: order.id, alreadyPaid: true })
  if (!settled) return res.status(500).json({ error: 'Could not settle order' })

  // Notify vendor
  await supabase.from('staff_notifications').insert({
    business_id: order.vendor_business_id,
    staff_id: null,
    is_owner: true,
    kind: 'shop_order_paid',
    title: `Shop order paid — ${order.order_ref}`,
    body: `Order ${order.order_ref} — ₦${(verifiedAmount / 100).toLocaleString()} via Paystack`,
    link: '/dashboard/ecommerce',
    read_at: null,
  }).then(() => {}, () => {})

  return res.status(200).json({ success: true, id: order.id, paid: true })
}
