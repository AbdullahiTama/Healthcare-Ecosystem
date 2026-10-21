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

// PostgREST silently caps a plain GET at 1000 rows. A report that reads
// "everything" must page, or its totals quietly stop at the cap.
const ALL_PAGE = 1000

export function createExpenseRepository(request = sbFetch) {
  return {
    async getAll(businessId) {
      const rows = []
      for (let offset = 0; ; offset += ALL_PAGE) {
        const page = await request(
          `expenses?business_id=eq.${businessId}&order=created_at.desc,id.asc&select=*&limit=${ALL_PAGE}&offset=${offset}`
        )
        rows.push(...page)
        if (page.length < ALL_PAGE) return rows
      }
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

    // Saves one expense and returns the stored row once the database confirms it.
    // The caller supplies `expense.id` (generated once per form), which makes a
    // double-click or a retried request idempotent: the second insert conflicts
    // on the primary key and is ignored instead of creating a duplicate. When the
    // insert was ignored the row is read back by id, so success is only reported
    // for a row that really exists for this business.
    async create(businessId, expense) {
      if (!expense?.id) throw new Error('An expense needs an id before it can be saved.')
      const inserted = await request('expenses?on_conflict=id', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=representation',
        body: JSON.stringify({ ...expense, business_id: businessId }),
      })
      if (inserted?.length) return inserted[0]
      const existing = await request(`expenses?id=eq.${expense.id}&business_id=eq.${businessId}&select=*`)
      if (!existing?.length) throw new Error('The expense could not be confirmed as saved.')
      return existing[0]
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
