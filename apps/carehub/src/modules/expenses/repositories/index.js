import { sbFetch } from '../../../services/supabase'
import { isMissingColumn } from '../../../lib/dbErrors'

// ── Expense repository ────────────────────────────────────────────────────────
// A deep module over the `expenses` table. The interface is small
// (getAll/create/delete/recordPayment/getPayments/getPage/getTotals/getCategories); the implementation
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

// A part-paid or unpaid expense cannot be stored until the database has the payment columns.
export class ExpensePaymentsUnavailable extends Error {
  constructor() {
    super('Recording an unpaid or part-paid expense needs the latest CareHub update, which is not installed yet. Record it as paid, or try again later.')
    this.name = 'ExpensePaymentsUnavailable'
  }
}

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

    // One expense, tenant-scoped, for opening it from the Owner's activity feed.
    async getById(businessId, expenseId) {
      const rows = await request(`expenses?id=eq.${expenseId}&business_id=eq.${businessId}&select=*`)
      return (Array.isArray(rows) ? rows[0] : rows) || null
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
    //
    // Payment status (carehub_20270107_expense_payments): `amount_paid` and `payment_method` are sent with the
    // expense. Before that migration is applied the table has neither column: a fully paid expense is then saved
    // without them (it means the same thing), and a part-paid or unpaid one is refused with ExpensePaymentsUnavailable
    // rather than silently recorded as paid.
    async create(businessId, expense) {
      if (!expense?.id) throw new Error('An expense needs an id before it can be saved.')
      const insert = (row) => request('expenses?on_conflict=id', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=representation',
        body: JSON.stringify({ ...row, business_id: businessId }),
      })
      let inserted
      try {
        inserted = await insert(expense)
      } catch (e) {
        if (!(isMissingColumn(e, 'amount_paid') || isMissingColumn(e, 'payment_method'))) throw e
        const { amount_paid: paid, payment_method: _method, ...legacy } = expense
        if (paid != null && Number(paid) < Number(expense.amount)) throw new ExpensePaymentsUnavailable()
        inserted = await insert(legacy)
      }
      if (inserted?.length) return inserted[0]
      const existing = await request(`expenses?id=eq.${expense.id}&business_id=eq.${businessId}&select=*`)
      if (!existing?.length) throw new Error('The expense could not be confirmed as saved.')
      return existing[0]
    },

    // ── Monthly budget (carehub_20270103_expense_budgets) ──
    // The budget in force for a month: that month's own, else the latest
    // earlier one (a budget carries over). { month, amount } or null.
    async getBudget(businessId, month) {
      const rows = await request(`expense_budgets?business_id=eq.${businessId}&month=lte.${month}&order=month.desc&limit=1&select=month,amount,updated_at`)
      const row = Array.isArray(rows) ? rows[0] : rows
      return row ? { month: row.month, amount: Number(row.amount) || 0, updatedAt: row.updated_at || null } : null
    },

    // Months that have a stored budget, to know which browser-held budgets
    // still need moving to the database.
    async getBudgetMonths(businessId) {
      const rows = await request(`expense_budgets?business_id=eq.${businessId}&select=month&order=month.asc&limit=1000`)
      return (rows || []).map((r) => r.month)
    },

    // Owner only (the database refuses anyone else). 0 = no budget from this month on.
    async setBudget(businessId, month, amount) {
      const rows = await request('rpc/set_expense_budget', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_month: month, p_amount: amount }),
      })
      const row = Array.isArray(rows) ? rows[0] : rows
      if (!row || row.month !== month) throw new Error('The budget could not be confirmed as saved.')
      return { month: row.month, amount: Number(row.amount) || 0, updatedAt: row.updated_at || null }
    },

    // Pays some or all of what is still owed on an expense (record_expense_payment: checks the caller's business,
    // the amount and the method, and writes the history row in the same transaction). Returns the new totals.
    async recordPayment(expenseId, { amount, method = 'Cash', paidOn = null, note = null, staffName = null }) {
      return request('rpc/record_expense_payment', {
        method: 'POST',
        body: JSON.stringify({ p_expense_id: expenseId, p_amount: amount, p_method: method, p_paid_on: paidOn || null, p_note: note || null, p_staff_name: staffName || null }),
      })
    },

    // An expense's payment history, oldest first (it reads as a running balance).
    async getPayments(businessId, expenseId) {
      return request(`expense_payments?business_id=eq.${businessId}&expense_id=eq.${expenseId}&order=created_at.asc,id.asc&select=*`)
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
