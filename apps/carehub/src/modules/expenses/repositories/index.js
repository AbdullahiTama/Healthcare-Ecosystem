import { sbFetch } from '../../../services/supabase'

// ── Expense repository ────────────────────────────────────────────────────────
// A deep module over the `expenses` table. The interface is small
// (getAll/create/delete); the implementation owns the PostgREST query shape and
// tenant scoping — every read and write is filtered by business_id so one
// organisation can never touch another's rows.
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
