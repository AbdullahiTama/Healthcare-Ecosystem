import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { isMissingColumn } from '../../../lib/dbErrors'

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

    // Paginated purchase list — use for table display
    async getPage(businessId, { search = '', month = '', year = '', offset = 0, limit = 50 } = {}) {
      const params = [`p_business_id=${businessId}`, `p_offset=${offset}`, `p_limit=${limit}`]
      if (search) params.push(`p_search=${encodeURIComponent(search)}`)
      if (month) params.push(`p_month=${month}`)
      if (year) params.push(`p_year=${year}`)
      return request(`rpc/get_purchases_page?${params.join('&')}`)
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

    // Previously an id-only PATCH in services/supabase.js, same class as the
    // debts write — now scoped to the tenant.
    async update(purchaseId, businessId, updates) {
      return request(`purchases?id=eq.${purchaseId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },
  }
}

export const purchaseRepository = createPurchaseRepository()
