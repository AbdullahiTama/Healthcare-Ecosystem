import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { isMissingColumn, isMissingObject } from '../../../lib/dbErrors'
import { translateBulkDeleteError, groupDeletions } from '../../../lib/bulkDelete'

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

// bulk_edit_purchases refuses with "CODE: sentence"; the sentence is shown (code kept). A missing function (the
// update is not installed yet) gets code EDIT_UNAVAILABLE.
function translateBulkEditError(error) {
  const msg = String(error?.message || '')
  if (/PGRST20[25]|Could not find the function/i.test(msg)) {
    return Object.assign(new Error('Bulk edit needs the latest CareHub update, which is not installed yet.'), { code: 'EDIT_UNAVAILABLE' })
  }
  const m = msg.match(/\b(EDIT_[A-Z_]+): (.+)$/)
  if (!m) return error
  const text = m[2].trim()
  return Object.assign(new Error(text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.')), { code: m[1] })
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

    // Supplier accounts (get_supplier_accounts, carehub_20270117): per supplier, its purchases plus its supply records
    // (hand-recorded or imported "we owe" debts without products), with supplied, paid and outstanding totals and a
    // count of items whose figures do not add up. Before the migration is applied, the purchase-only totals
    // (get_supplier_balances) in the same shape, with `available: false` (account payments and supply records are
    // then not offered). Returns { available, rows }.
    async getSupplierAccounts(businessId) {
      try {
        const rows = await request('rpc/get_supplier_accounts', { method: 'POST', body: JSON.stringify({ p_business_id: businessId }) })
        return { available: true, rows: rows || [] }
      } catch (e) {
        if (!isMissingObject(e)) throw e
        const rows = await request(`rpc/get_supplier_balances?p_business_id=${businessId}`)
        return {
          available: false,
          rows: (rows || []).map((r) => ({
            supplier_key: r.supplier_key, supplier_name: r.supplier_name, purchase_count: r.purchase_count, supply_count: 0,
            supplied_total: r.total_cost, paid_total: r.amount_paid, balance: r.balance, open_count: r.open_count, mismatch_count: 0,
            last_supply_at: r.last_purchase_at,
          })),
        }
      }
    },

    // One supplier's supplies (purchases and supply records) and every payment to it (get_supplier_activity). Before
    // the migration: its purchases and purchase payments only. Returns { supplies, payments }.
    async getSupplierActivity(businessId, supplierKey) {
      try {
        const r = await request('rpc/get_supplier_activity', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_supplier_key: supplierKey }) })
        const a = Array.isArray(r) ? r[0] : r
        return { supplies: a?.supplies || [], payments: a?.payments || [] }
      } catch (e) {
        if (!isMissingObject(e)) throw e
        const [purchases, payments] = await Promise.all([
          request('rpc/get_supplier_purchases', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_supplier_key: supplierKey }) }),
          pagedQuery(request, `purchase_payments?business_id=eq.${businessId}&supplier_key=eq.${encodeURIComponent(supplierKey)}&order=created_at.desc,id.asc&select=*`),
        ])
        return {
          supplies: (purchases || []).map((p) => ({
            kind: 'purchase', id: p.id, party_name: p.supplier_name, date: p.supply_date, created_at: p.created_at,
            description: p.product_name || 'Purchase', lines: Array.isArray(p.items) ? p.items.length : null,
            amount: p.total_cost, paid: p.amount_paid, balance: Math.max(Number(p.balance) || 0, 0), due_date: p.due_date, status: p.status,
          })),
          payments: (payments || []).map((x) => ({ ...x, source: 'purchase', item_id: x.purchase_id })),
        }
      }
    },

    // One payment to a supplier, applied to its open purchases and supply records oldest first, all or nothing
    // (record_supplier_payment). Returns { allocation_id, amount, allocations: [{ kind, id, amount, balance }], balance }.
    async recordSupplierPayment(businessId, supplierKey, { amount, method = 'Transfer', paidOn = null, note = null, staffName = null }) {
      const r = await request('rpc/record_supplier_payment', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_supplier_key: supplierKey, p_amount: amount, p_method: method, p_paid_on: paidOn || null, p_note: note || null, p_staff_name: staffName || null }),
      })
      return Array.isArray(r) ? r[0] : r
    },

    // The purchases from one supplier, matched by the same key as the totals
    // (case and surrounding spaces ignored), newest first.
    async getBySupplier(businessId, supplierKey) {
      return request('rpc/get_supplier_purchases', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_supplier_key: supplierKey }),
      })
    },

    // Bulk edit (carehub_20270114): the same header changes (supplier_name, supply_date, due_date, notes) on many
    // purchases, each through edit_purchase on the server. Returns { updated, unchanged, rows, failed, skipped }.
    async bulkEdit(businessId, purchaseIds, changes, { reason, staffName = null } = {}) {
      try {
        const result = await request('rpc/bulk_edit_purchases', {
          method: 'POST',
          body: JSON.stringify({ p_business_id: businessId, p_purchase_ids: purchaseIds, p_changes: changes, p_reason: reason, p_staff_name: staffName || null }),
        })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkEditError(e)
      }
    },

    // Deletes purchases through delete_purchases: each purchase's stock is taken back through the ledger, then it is
    // copied (with its payments and debt) for restore and audited. A purchase whose stock cannot be taken back is kept.
    // Returns { deletion_id, deleted, kept: [{ id, name, reasons, product, ref }], not_found }.
    async deleteMany(businessId, purchaseIds) {
      try {
        const result = await request('rpc/delete_purchases', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_purchase_ids: purchaseIds }) })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkDeleteError(e, 'purchase')
      }
    },

    // Puts a deletion's purchases back: same ids, lines, payments, debt, recorder; stock back into the same batch.
    // Returns { restored, skipped_already_back, skipped_stock, skipped: [{ id, name, product }] }.
    async restoreDeleted(businessId, deletionId) {
      try {
        const result = await request('rpc/restore_deleted_purchases', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_deletion_id: deletionId }) })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateBulkDeleteError(e, 'purchase')
      }
    },

    // Deletions of this business's purchases, newest first, one entry per deletion.
    async getDeletions(businessId) {
      try {
        const rows = await pagedQuery(request, `deleted_purchases?business_id=eq.${businessId}&order=deleted_at.desc,id.asc&select=id,deletion_id,supplier_name,deleted_at,deleted_by_name,restored_at`)
        return groupDeletions(rows, 'supplier_name')
      } catch (e) {
        throw translateBulkDeleteError(e, 'purchase')
      }
    },

    // Every purchase matching the list's filters (the getPage arguments: search,
    // from/to supply dates, supplierKey), page by page.
    async getAllPages(businessId, filters = {}, { pageSize = 500, onProgress } = {}) {
      const all = []
      for (;;) {
        const page = await this.getPage(businessId, { ...filters, offset: all.length, limit: pageSize })
        all.push(...(page || []))
        onProgress?.(all.length)
        if (!page || page.length < pageSize) break
      }
      return all
    },

    // Every purchase matching the list's filters (the getPage arguments), with
    // its invoice lines (`items`), for the export. get_purchases_page does not
    // return items, so they are read by id in chunks, scoped to the business.
    async getAllForExport(businessId, filters = {}, { pageSize = 500, onProgress } = {}) {
      const all = await this.getAllPages(businessId, filters, { pageSize, onProgress })
      const items = new Map()
      for (let i = 0; i < all.length; i += 100) {
        const ids = all.slice(i, i + 100).map(p => p.id)
        const rows = await request(`purchases?business_id=eq.${businessId}&id=in.(${ids.join(',')})&select=id,items`)
        for (const r of rows || []) items.set(String(r.id), r.items)
      }
      return all.map(p => ({ ...p, items: items.get(String(p.id)) ?? null }))
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
