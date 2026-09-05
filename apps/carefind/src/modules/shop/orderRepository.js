// Order repository — shop_orders family with row-locked inventory decrement
// Uses new create_shop_order RPC (idempotent on payment_reference, price-validated)

import { supabase } from '../../config/supabaseClient'

export function createOrderRepository(supabaseClient = supabase) {
  async function create({
    customer_id,
    vendor_business_id,
    vendor_id, // alias
    items, // [{ecommerce_product_id, quantity, unit_price_kobo}]
    subtotal_kobo,
    total_kobo,
    commission_kobo,
    fulfilment_kobo,
    delivery_kobo,
    delivery_address,
    delivery_city,
    delivery_state,
    delivery_phone,
    delivery_email,
    delivery_instructions,
    delivery_preference,
    distance_km,
    is_approved_city,
    customer_name,
    payment_reference,
    pickup_station_id
  }) {
    const vendorBusinessId = vendor_business_id || vendor_id
    const subtotal = subtotal_kobo ?? total_kobo ?? items.reduce((s, i) => s + i.unit_price_kobo * i.quantity, 0)
    const total = total_kobo ?? (subtotal + (fulfilment_kobo||0) + (delivery_kobo||0))
    const { data, error } = await supabaseClient.rpc('create_shop_order', {
      p_customer_id: customer_id,
      p_vendor_business_id: vendorBusinessId,
      p_items: items.map(i => ({ ecommerce_product_id: i.ecommerce_product_id, quantity: i.quantity, unit_price_kobo: i.unit_price_kobo })),
      p_subtotal_kobo: subtotal,
      p_commission_kobo: commission_kobo || 0,
      p_fulfilment_kobo: fulfilment_kobo || 0,
      p_delivery_kobo: delivery_kobo || 0,
      p_total_kobo: total,
      p_delivery_address: delivery_address,
      p_delivery_city: delivery_city || null,
      p_delivery_state: delivery_state || null,
      p_delivery_phone: delivery_phone || null,
      p_delivery_email: delivery_email || null,
      p_delivery_instructions: delivery_instructions || null,
      p_delivery_preference: delivery_preference || 'pickup',
      p_distance_km: distance_km ?? null,
      p_is_approved_city: is_approved_city ?? true,
      p_customer_name: customer_name || null,
      p_payment_reference: payment_reference,
      p_pickup_station_id: pickup_station_id || null
    })
    if (error) {
      if (error.message && error.message.includes('Insufficient stock')) throw new Error('INSUFFICIENT_STOCK')
      if (error.message && error.message.includes('Price mismatch')) throw new Error('PRICE_CHANGED: ' + error.message)
      throw error
    }
    return data
  }

  async function getById(orderId) {
    const { data: order, error: orderError } = await supabaseClient
      .from('shop_orders')
      .select('*')
      .eq('id', orderId)
      .single()
    if (orderError) throw orderError
    if (!order) return null
    const [{ data: items }, { data: history }] = await Promise.all([
      supabaseClient.from('shop_order_items').select('*').eq('order_id', orderId),
      supabaseClient.from('shop_order_status_history').select('*').eq('order_id', orderId).order('created_at', { ascending: true })
    ])
    return { ...order, shop_order_items: items || [], order_items: items || [], shop_order_status_history: history || [], order_status_history: history || [] }
  }

  async function getByCustomer(customerId, { status, limit = 50, offset = 0 } = {}) {
    let query = supabaseClient
      .from('shop_orders')
      .select('*, shop_order_items(*)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw error
    // Normalize for OrderList which expects order_items
    return (data || []).map(o => ({ ...o, order_items: o.shop_order_items || [] }))
  }

  async function getByVendor(vendorBusinessId, { status, limit = 50, offset = 0 } = {}) {
    let query = supabaseClient
      .from('shop_orders')
      .select('*, shop_order_items(*), profiles:customer_id(id, full_name, email)')
      .eq('vendor_business_id', vendorBusinessId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw error
    return (data || []).map(o => ({ ...o, order_items: o.shop_order_items || [] }))
  }

  async function updateStatus(orderId, status, changedBy, note) {
    const { error } = await supabaseClient.rpc('update_shop_order_status', {
      p_order_id: orderId,
      p_to_status: status,
      p_changed_by: changedBy,
      p_note: note || null
    })
    if (error) throw error
  }

  async function cancel(orderId, changedBy, reason) {
    const { data, error } = await supabaseClient.rpc('cancel_shop_order', {
      p_order_id: orderId,
      p_reason: reason || null
    })
    if (error) throw error
    if (data && data !== 'ok' && data.startsWith('already')) throw new Error(data)
  }

  async function addMessage(orderId, senderId, message, senderRole = 'customer') {
    // Use RPC so server derives sender_role and auth.uid() correctly
    const { data, error } = await supabaseClient.rpc('shop_add_message', {
      p_order_id: orderId,
      p_message: message
    })
    if (error) throw error
    return data
  }
  async function verifyPayment(orderId, paystackReference) {
    const { data, error } = await supabaseClient.rpc('verify_shop_payment', {
      p_order_id: orderId,
      p_paystack_reference: paystackReference
    })
    if (error) throw error
    return data
  }

  async function getMessages(orderId) {
    const { data, error } = await supabaseClient
      .from('shop_order_messages')
      .select('*, profiles:sender_id(id, full_name)')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  }

  return {
    create,
    getById,
    getByCustomer,
    getByVendor,
    updateStatus,
    cancel,
    addMessage,
    getMessages,
    verifyPayment
  }
}

export const orderRepository = createOrderRepository()
