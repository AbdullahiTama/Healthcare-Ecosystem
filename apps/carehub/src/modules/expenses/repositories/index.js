import { sbFetch } from '../../../services/supabase'

// ── Expense repository ────────────────────────────────────────────────────────
// A deep module over the `expenses` table. The interface is small
// (getAll/create/delete/getPage/getTotals/getCategories); the implementation
// owns the PostgREST query shape and tenant scoping — every read and write is
// filtered by business_id so one organisation can never touch another's rows.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
export function createExpenseRepository(request = sbFetch) {
  return {
    async getAll(businessId) {
      return request(`expenses?business_id=eq.${businessId}&order=created_at.desc&select=*`)
    },

    // Paginated expense list — use for table display
    async getPage(businessId, { month = null, offset = 0, limit = 50 } = {}) {
      const params = [`p_business_id=${businessId}`, `p_offset=${offset}`, `p_limit=${limit}`]
      if (month) params.push(`p_month=${month}`)
      return request(`rpc/get_expenses_page?${params.join('&')}`)
    },

    // Monthly totals (amount + count) — use for stats and budget tracker
    async getTotals(businessId, month = null) {
      const params = [`p_business_id=${businessId}`]
      if (month) params.push(`p_month=${month}`)
      return request(`rpc/get_expense_totals?${params.join('&')}`)
    },

    // Category breakdown — use for category chart
    async getCategories(businessId, month = null) {
      const params = [`p_business_id=${businessId}`]
      if (month) params.push(`p_month=${month}`)
      return request(`rpc/get_expense_summary?${params.join('&')}`)
    },

    async create(businessId, expense) {
      return request('expenses', {
        method: 'POST',
        body: JSON.stringify({ ...expense, business_id: businessId }),
      })
    },

    async delete(expenseId, businessId) {
      return request(`expenses?id=eq.${expenseId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },
  }
}

export const expenseRepository = createExpenseRepository()
