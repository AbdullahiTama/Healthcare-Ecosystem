// Order repository - manages orders with atomic inventory decrement
// Uses Supabase client for database operations

import { supabase } from '../../config/supabaseClient'

export function createOrderRepository(supabaseClient = supabase) {
  // Create order with atomic inventory decrement
  async function create({ customer_id, vendor_id, items, total_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, delivery_address, delivery_preference, payment_reference }) {
    const { data, error } = await supabaseClient.rpc('create_order_with_inventory_decrement', {
      p_customer_id: customer_id,
      p_vendor_id: vendor_id,
      p_items: items,
      p_total_kobo: total_kobo,
      p_commission_kobo: commission_kobo,
      p_fulfilment_kobo: fulfilment_kobo,
      p_delivery_kobo: delivery_kobo,
      p_delivery_address: delivery_address,
      p_delivery_preference: delivery_preference,
      p_payment_reference: payment_reference
    })

    if (error) {
      if (error.message.includes('Insufficient stock')) {
        throw new Error('INSUFFICIENT_STOCK')
      }
      throw error
    }

    return data // Returns order_id
  }

  // Get order by ID (with items and status history)
  async function getById(orderId) {
    const { data: order, error: orderError } = await supabaseClient
      .from('orders')
      .select(`
        *,
        order_items(*),
        order_status_history(*)
      `)
      .eq('id', orderId)
      .single()

    if (orderError) throw orderError
    if (!order) return null

    return order
  }

  // Get orders by customer ID
  async function getByCustomer(customerId, { status, limit = 50, offset = 0 } = {}) {
    let query = supabaseClient
      .from('orders')
      .select(`
        *,
        order_items(*)
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error

    return data || []
  }

  // Get orders by vendor ID
  async function getByVendor(vendorId, { status, limit = 50, offset = 0 } = {}) {
    let query = supabaseClient
      .from('orders')
      .select(`
        *,
        order_items(*),
        profiles:customer_id(id, full_name, email)
      `)
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error

    return data || []
  }

  // Update order status
  async function updateStatus(orderId, status, changedBy) {
    const { error } = await supabaseClient.rpc('update_order_status', {
      p_order_id: orderId,
      p_status: status,
      p_changed_by: changedBy
    })

    if (error) throw error
  }

  // Cancel order (restores inventory)
  async function cancel(orderId, changedBy) {
    // First restore inventory
    const { error: restoreError } = await supabaseClient.rpc('restore_inventory_on_cancel', {
      p_order_id: orderId
    })

    if (restoreError) throw restoreError

    // Then update status
    await updateStatus(orderId, 'cancelled', changedBy)
  }

  // Add message to order
  async function addMessage(orderId, senderId, message) {
    const { data, error } = await supabaseClient
      .from('order_messages')
      .insert({
        order_id: orderId,
        sender_id: senderId,
        message: message
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  // Get messages for order
  async function getMessages(orderId) {
    const { data, error } = await supabaseClient
      .from('order_messages')
      .select(`
        *,
        profiles:sender_id(id, full_name)
      `)
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
    getMessages
  }
}

// Singleton instance
export const orderRepository = createOrderRepository()
