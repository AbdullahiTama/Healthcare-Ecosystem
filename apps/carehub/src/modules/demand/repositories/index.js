import { sbFetch } from '../../../services/supabase'

export function createDemandRepository({ request = sbFetch } = {}) {
  return {
    async getOutOfStock(businessId) {
      return request(`out_of_stock?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async addOutOfStock(data) {
      return request('out_of_stock', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },

    async updateOutOfStock(id, data) {
      return request(`out_of_stock?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        prefer: 'return=minimal',
      })
    },

    async getCustomerRequests(businessId) {
      return request(`customer_requests?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    async addCustomerRequest(data) {
      return request('customer_requests', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },

    async updateCustomerRequest(id, data) {
      return request(`customer_requests?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        prefer: 'return=minimal',
      })
    },

    async getRequisitions(businessId) {
      const reqs = await request(`requisitions?business_id=eq.${businessId}&order=created_at.desc&select=*`)
      const list = reqs || []
      const ids = list.map(r => r.id)
      if (ids.length === 0) return list
      const items = await request(`requisition_items?requisition_id=in.(${ids.join(',')})&select=*`)
      const byReq = {}
      ;(items || []).forEach(it => { (byReq[it.requisition_id] = byReq[it.requisition_id] || []).push(it) })
      return list.map(r => ({ ...r, items: byReq[r.id] || [] }))
    },

    async addRequisition({ business_id, supplier_name, note, items }) {
      return request('rpc/create_requisition', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: business_id, p_supplier_name: supplier_name, p_note: note || null, p_items: items || [] }),
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      })
    },

    async updateRequisition(id, data) {
      return request(`requisitions?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        prefer: 'return=minimal',
      })
    },
  }
}

export const demandRepository = createDemandRepository()
