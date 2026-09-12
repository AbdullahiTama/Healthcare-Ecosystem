import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Requests a return/refund for a delivered shop order.
// Body: { order_id, reason, description? }
// Validates: order exists, user owns it, status is delivered, within 7-day window
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Authentication required' })

  const { order_id: orderId, reason, description } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'Missing order_id' })
  if (!reason) return res.status(400).json({ error: 'Missing reason' })

  // Get order details
  const { data: order, error: orderError } = await supabase
    .from('shop_orders')
    .select('id, customer_id, vendor_business_id, status, total_kobo, order_ref, updated_at')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !order) {
    return res.status(404).json({ error: 'Order not found' })
  }

  // Verify ownership
  if (order.customer_id !== user.id) {
    return res.status(403).json({ error: 'Not your order' })
  }

  // Check status is delivered
  if (order.status !== 'delivered') {
    return res.status(400).json({ error: 'Can only request return for delivered orders' })
  }

  // Check 7-day window
  const deliveredAt = new Date(order.updated_at)
  const now = new Date()
  const daysSinceDelivery = Math.floor((now - deliveredAt) / (1000 * 60 * 60 * 24))
  if (daysSinceDelivery > 7) {
    return res.status(400).json({ error: 'Return window (7 days) has expired' })
  }

  // Check no existing return request
  const { data: existingReturn } = await supabase
    .from('shop_order_returns')
    .select('id, status')
    .eq('order_id', orderId)
    .in('status', ['requested', 'approved', 'completed'])
    .maybeSingle()

  if (existingReturn) {
    return res.status(400).json({ error: 'Return already requested for this order' })
  }

  // Call the RPC to create the return request
  const { data: returnId, error: rpcError } = await supabase.rpc('request_shop_return', {
    p_order_id: orderId,
    p_reason: reason,
    p_description: description || null,
    p_refund_amount_kobo: order.total_kobo
  })

  if (rpcError) {
    return res.status(500).json({ error: rpcError.message || 'Failed to create return request' })
  }

  return res.status(200).json({ 
    success: true, 
    return_id: returnId,
    message: 'Return request submitted successfully'
  })
}
