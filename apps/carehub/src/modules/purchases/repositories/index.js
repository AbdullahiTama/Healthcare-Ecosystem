import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { isMissingColumn } from '../../../lib/dbErrors'

// The analytics filters every history/summary function takes, as RPC
// arguments. `from`/`to` are inclusive 'YYYY-MM-DD' supply dates; a supplier is
// its key (case and surrounding spaces ignored); a product is matched by id OR
// name, so lines saved before products were recorded on them still count.
function filterArgs(businessId, { from = null, to = null, search = '', supplierKey = '', productKey = '', productId = null } = {}) {
  return {
    p_business_id: businessId,
    p_from: from || null,
    p_to: to || null,
    p_search: String(search || '').trim() || null,
    p_supplier_key: String(supplierKey || '').trim() || null,
    p_product_key: String(productKey || '').trim() || null,
    p_product_id: productId || null,
  }
}

// ── Purchase repository ───────────────────────────────────────────────────────
// A deep module over the `purchases` table. The interface is small
// (getAll/create/update/getPage/getTotals); the implementation owns the
// PostgREST query shape and tenant scoping — every read and write is filtered
// by business_id so one organisation can never touch another's rows.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// Note this aggregate covers the purchase *record* only. Recording a purchase
// also replenishes inventory and may raise a debt; those belong to the product
// and debt aggregates, and Purchases.jsx composes the three rather than this
// repository reaching across into tables it does not own.
export function createPurchaseRepository(request = sbFetch) {
  return {
    // Paged past the server's 1000-row cap. `from`/`to` (ISO, optional)
    // restrict to purchases created in [from, to).
    async getAll(businessId, { from, to } = {}) {
      let q = `purchases?business_id=eq.${businessId}`
      if (from) q += `&created_at=gte.${from}`
      if (to) q += `&created_at=lt.${to}`
      return pagedQuery(request, `${q}&order=created_at.desc,id.asc&select=*`)
    },

    // Paginated purchase list — use for table display. `from`/`to` are an
    // inclusive supply-date range and `supplierKey` one supplier
    // (carehub_20261229); `month`/`year` are the older created-date filters.
    async getPage(businessId, { search = '', month = '', year = '', from = '', to = '', supplierKey = '', offset = 0, limit = 50 } = {}) {
      const params = [`p_business_id=${businessId}`, `p_offset=${offset}`, `p_limit=${limit}`]
      if (search) params.push(`p_search=${encodeURIComponent(search)}`)
      if (month) params.push(`p_month=${month}`)
      if (year) params.push(`p_year=${year}`)
      if (from) params.push(`p_from=${from}`)
      if (to) params.push(`p_to=${to}`)
      if (supplierKey) params.push(`p_supplier_key=${encodeURIComponent(supplierKey)}`)
      return request(`rpc/get_purchases_page?${params.join('&')}`)
    },

    // The purchase's lines as the edit screen needs them: each with its stable
    // id, the product it stocked, what it added to stock, the lowest quantity
    // it can be set to, and whether it is locked (get_purchase_for_edit).
    async getForEdit(purchaseId) {
      return request('rpc/get_purchase_for_edit', { method: 'POST', body: JSON.stringify({ p_purchase_id: purchaseId }) })
    },

    // Edits a purchase in one transaction (edit_purchase): the server checks
    // the "Edit purchases" permission, recomputes every total, moves stock by
    // the difference per line through the stock ledger, and keeps the debt,
    // the payment history and the audit log in step. Returns
    // { purchase, unchanged, products, stock_changes, created_products }.
    // `amountPaid` is null unless the user changed it (the server then keeps
    // the current figure, payments recorded meanwhile included).
    // `expectedEditCount` / `expectedAmountPaid` are what the screen loaded: if
    // either moved since, the server refuses instead of overwriting.
    async edit(purchaseId, { supplier, supplyDate, dueDate = null, notes = '', items, amountPaid = null, reason, staffName = null, expectedEditCount = null, expectedAmountPaid = null }) {
      return request('rpc/edit_purchase', {
        method: 'POST',
        body: JSON.stringify({
          p_purchase_id: purchaseId,
          p_supplier_name: supplier,
          p_supply_date: supplyDate,
          p_due_date: dueDate || null,
          p_notes: notes || '',
          p_items: items,
          p_amount_paid: amountPaid,
          p_reason: reason,
          p_staff_name: staffName || null,
          p_expected_edit_count: expectedEditCount,
          p_expected_amount_paid: expectedAmountPaid,
        }),
      })
    },

    // Who changed the purchase, when and why (audit_log, newest first).
    async getEditHistory(purchaseId, businessId) {
      return request(`audit_log?branch_id=eq.${businessId}&target_id=eq.${purchaseId}&action=eq.purchase.edited&order=created_at.desc&select=id,created_at,actor_type,metadata`)
    },

    // ── Purchase history and analytics (carehub_20261229) ────────────────────
    // Every purchase line across products and suppliers, newest first.
    async getHistory(businessId, filters = {}, { offset = 0, limit = 50 } = {}) {
      return request('rpc/get_purchase_history', {
        method: 'POST',
        body: JSON.stringify({ ...filterArgs(businessId, filters), p_offset: offset, p_limit: limit }),
      })
    },

    // One row of totals for the selection (spend, paid, outstanding, counts,
    // first/last purchase, payments made in the period).
    async getSummary(businessId, filters = {}) {
      const rows = await request('rpc/get_purchase_summary', { method: 'POST', body: JSON.stringify(filterArgs(businessId, filters)) })
      return (Array.isArray(rows) ? rows[0] : rows) || null
    },

    // Spending per supplier for the selection, biggest first.
    async getSupplierStats(businessId, filters = {}) {
      const { p_supplier_key: _ignored, ...args } = filterArgs(businessId, filters)
      return request('rpc/get_purchase_supplier_stats', { method: 'POST', body: JSON.stringify(args) })
    },

    // Per product: times bought, units, spend, average/lowest/highest cost,
    // last purchase and the price before it. `total_count` on each row.
    async getProductStats(businessId, filters = {}, { sort = 'spend', offset = 0, limit = 50 } = {}) {
      return request('rpc/get_purchase_product_stats', {
        method: 'POST',
        body: JSON.stringify({ ...filterArgs(businessId, filters), p_sort: sort, p_offset: offset, p_limit: limit }),
      })
    },

    // Purchase totals — use for stat cards
    async getTotals(businessId) {
      return request(`rpc/get_purchase_totals?p_business_id=${businessId}`)
    },

    // Records a payment to the supplier against a purchase (full or part). The
    // database locks the purchase, refuses zero, negative, more-than-the-balance
    // or future-dated payments, updates amount_paid / balance / status
    // ('partial' | 'paid') and the linked debt, and writes a history row, in
    // one transaction (record_purchase_payment).
    async recordPayment(purchaseId, { amount, method = 'Transfer', paidOn = null, note = null, staffName = null }) {
      return request('rpc/record_purchase_payment', {
        method: 'POST',
        body: JSON.stringify({ p_purchase_id: purchaseId, p_amount: amount, p_method: method, p_paid_on: paidOn || null, p_note: note, p_staff_name: staffName }),
      })
    },

    // Payment history, newest first: for one purchase, or for every purchase
    // from one supplier (supplierKey = lower-cased, trimmed supplier name).
    async getPayments(businessId, { purchaseId, supplierKey } = {}) {
      let q = `purchase_payments?business_id=eq.${businessId}`
      if (purchaseId) q += `&purchase_id=eq.${purchaseId}`
      if (supplierKey) q += `&supplier_key=eq.${encodeURIComponent(supplierKey)}`
      return pagedQuery(request, `${q}&order=created_at.desc,id.asc&select=*`)
    },

    // Totals per supplier (get_supplier_balances): bought, paid, outstanding.
    async getSupplierBalances(businessId) {
      return request(`rpc/get_supplier_balances?p_business_id=${businessId}`)
    },

    // The purchases from one supplier, matched by the same key as the totals
    // (case and surrounding spaces ignored), newest first.
    async getBySupplier(businessId, supplierKey) {
      return request('rpc/get_supplier_purchases', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_supplier_key: supplierKey }),
      })
    },

    async getById(purchaseId, businessId) {
      const rows = await request(`purchases?id=eq.${purchaseId}&business_id=eq.${businessId}&select=*`)
      return (Array.isArray(rows) ? rows[0] : rows) || null
    },

    // `items` (the invoice lines) needs carehub_20261213; until that column
    // exists the purchase is saved without its lines rather than not at all.
    async create(businessId, purchase) {
      const send = (row) => request('purchases', {
        method: 'POST',
        body: JSON.stringify({ ...row, business_id: businessId }),
      })
      try {
        return await send(purchase)
      } catch (e) {
        if (!('items' in purchase) || !isMissingColumn(e, 'items')) throw e
        console.warn('[purchases] items column not deployed yet; saved without line items')
        const withoutItems = { ...purchase }
        delete withoutItems.items
        return send(withoutItems)
      }
    },

  }
}

export const purchaseRepository = createPurchaseRepository()
