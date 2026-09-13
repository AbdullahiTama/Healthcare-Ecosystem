import { adminTransport } from './transport.js'

export function createCommerceRepository(transport = adminTransport) {
  return {
    async getShopOrders({ limit = 100, offset = 0 } = {}) {
      const { data } = await transport.api('list_shop_orders_admin')
      return data || []
    },

    async getEcomApplications() {
      const { data } = await transport.api('list_ecommerce_applications')
      return data || []
    },

    async updateEcomApplication(id, status) {
      return transport.api('update_ecommerce_application', { id, status })
    },

    async getRevenue({ dateFrom = '', dateTo = '' } = {}) {
      const { data } = await transport.api('list_transactions')
      let rows = data || []

      if (dateFrom) rows = rows.filter(t => t.created_at >= dateFrom)
      if (dateTo) rows = rows.filter(t => t.created_at <= dateTo)

      return rows
    },

    async getWithdrawals() {
      const { data } = await transport.api('list_withdrawal_requests')
      return data || []
    },

    async approveWithdrawal(id) {
      return transport.api('approve_withdrawal', { id })
    },

    async rejectWithdrawal(id) {
      return transport.api('reject_withdrawal', { id })
    },

    async getBusinesses({ search = '', type = 'all', state = '', status = 'all', limit = 100, offset = 0 } = {}) {
      const filters = []

      if (type !== 'all') filters.push({ op: 'eq', col: 'business_type', val: type })
      if (state) filters.push({ op: 'eq', col: 'state', val: state })
      if (status === 'visible') filters.push({ op: 'eq', col: 'visible_on_carefind', val: true })
      else if (status === 'hidden') filters.push({ op: 'eq', col: 'visible_on_carefind', val: false })

      const { data } = await transport.query('businesses', {
        select: 'id, name, business_type, city, state, whatsapp, visible_on_carefind, created_at',
        filters,
        order: { column: 'created_at', ascending: false },
        limit,
        offset,
      })

      if (search) {
        const q = search.toLowerCase()
        return data.filter(b =>
          (b.name || '').toLowerCase().includes(q) ||
          (b.city || '').toLowerCase().includes(q)
        )
      }

      return data
    },
  }
}

export const commerceRepository = createCommerceRepository()
