import { sbFetch } from '../../../services/supabase'

// ── Purchase repository ───────────────────────────────────────────────────────
// A deep module over the `purchases` table. The interface is small
// (getAll/create/update); the implementation owns the PostgREST query shape and
// tenant scoping — every read and write is filtered by business_id so one
// organisation can never touch another's rows.
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
