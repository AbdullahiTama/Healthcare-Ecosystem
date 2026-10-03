import { sbFetch } from '../../../services/supabase'

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
    async getAll(businessId) {
      return request(`purchases?business_id=eq.${businessId}&order=created_at.desc&select=*`)
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

    async create(businessId, purchase) {
      return request('purchases', {
        method: 'POST',
        body: JSON.stringify({ ...purchase, business_id: businessId }),
      })
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
