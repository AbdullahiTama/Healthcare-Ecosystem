import { sbFetch } from '../../services/supabase'

export function createShopVendorRepository({ request = sbFetch } = {}) {
  return {
    async listOrders(businessId, { status, search } = {}) {
      let q = `shop_orders?vendor_business_id=eq.${businessId}&order=created_at.desc&select=*,shop_order_items(*),shop_order_status_history(*)`
      if (status) q += `&status=eq.${status}`
      const rows = await request(q)
      let list = rows || []
      if (search) {
        const s = String(search).toLowerCase()
        list = list.filter(r =>
          String(r.order_ref||'').toLowerCase().includes(s) ||
          String(r.customer_name||'').toLowerCase().includes(s) ||
          String(r.delivery_address||'').toLowerCase().includes(s) ||
          (r.shop_order_items||[]).some(i => String(i.product_name).toLowerCase().includes(s))
        )
      }
      return list
    },
    async getOrder(orderId) {
      const [o, items, history, msgs] = await Promise.all([
        request(`shop_orders?id=eq.${orderId}&select=*`).then(r=>r[0]||null),
        request(`shop_order_items?order_id=eq.${orderId}&select=*`).catch(()=>[]),
        request(`shop_order_status_history?order_id=eq.${orderId}&order=created_at.asc&select=*`).catch(()=>[]),
        request(`shop_order_messages?order_id=eq.${orderId}&order=created_at.asc&select=*`).catch(()=>[]),
      ])
      if (!o) return null
      return { ...o, items: items||[], history: history||[], messages: msgs||[] }
    },
    async updateStatus(orderId, toStatus, note) {
      // Use RPC via sbFetch
      return request('rpc/update_shop_order_status', {
        method: 'POST',
        body: JSON.stringify({ p_order_id: orderId, p_to_status: toStatus, p_changed_by: null, p_note: note || null })
      })
    },
    async sendMessage(orderId, message) {
      return request('rpc/shop_add_message', {
        method: 'POST',
        body: JSON.stringify({ p_order_id: orderId, p_message: message })
      })
    }
  }
}
export const shopVendorRepository = createShopVendorRepository()
