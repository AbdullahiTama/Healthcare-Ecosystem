import { sbFetch } from '../../../services/supabase'

// ── Product repository ────────────────────────────────────────────────────────
// A deep module over the `products` / `stock_batches` tables. Its interface is
// small (getAll/getById/create/update/delete/deleteBulk/…); the implementation
// owns two things callers must never re-derive: the PostgREST query shape and
// tenant scoping — every read and write is filtered by business_id so one
// organisation can never touch another's rows.
//
// The repository's only outside dependency is `request`, a function with
// sbFetch's shape: (path, options) => Promise<rows>. Production binds the real
// PostgREST-backed sbFetch (the default below); tests bind an in-memory adapter.
// That injected transport is the seam — one interface, two adapters.
export function createProductRepository(request = sbFetch) {
  return {
    async getAll(businessId) {
      return request(`products?business_id=eq.${businessId}&order=name.asc&select=*`)
    },

    async getById(productId, businessId) {
      const results = await request(`products?id=eq.${productId}&business_id=eq.${businessId}&select=*`)
      return results[0] || null
    },

    async create(businessId, product) {
      return request('products', {
        method: 'POST',
        body: JSON.stringify({ ...product, business_id: businessId }),
      })
    },

    async update(productId, businessId, updates) {
      return request(`products?id=eq.${productId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    async delete(productId, businessId) {
      return request(`products?id=eq.${productId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // Deletes many products in one round-trip, scoped to the tenant so an id
    // list can never reach across the business boundary. Empty list is a no-op
    // (an unscoped `id=in.()` would otherwise be a malformed request).
    async deleteBulk(productIds, businessId) {
      if (!productIds || productIds.length === 0) return
      return request(`products?id=in.(${productIds.join(',')})&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    async getStockBatches(businessId) {
      return request(`stock_batches?business_id=eq.${businessId}&order=expiry_date.asc.nullslast&select=*`)
    },

    async addStockBatch(businessId, batch) {
      return request('stock_batches', {
        method: 'POST',
        body: JSON.stringify({ ...batch, business_id: businessId }),
      })
    },

    // NOTE: a previous `updateStock` issued an unscoped PATCH with a
    // `{ stock: { increment } }` body PostgREST does not honour — it was dead
    // and would have corrupted every row's stock. Removed. Stock changes go
    // through update() with a read-modify-written value. A truly atomic
    // increment needs a Postgres RPC (out of scope for this pilot).
  }
}

export const productRepository = createProductRepository()

export const purchaseRepository = {
  async getAll(businessId) {
    return sbFetch(`purchases?business_id=eq.${businessId}&order=created_at.desc&select=*`)
  },

  async create(businessId, purchase) {
    return sbFetch('purchases', {
      method: 'POST',
      body: JSON.stringify({ ...purchase, business_id: businessId }),
    })
  },

  async update(purchaseId, businessId, updates) {
    return sbFetch(`purchases?id=eq.${purchaseId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },
}

// expenseRepository moved to modules/expenses/repositories (its own aggregate).
// purchaseRepository (above) and debtRepository (below) still live here
// unused/misplaced — they belong in modules/purchases and modules/debts and
// should move as those modules adopt the repository seam.

export const debtRepository = {
  async getAll(businessId) {
    return sbFetch(`debts?business_id=eq.${businessId}&order=created_at.desc&select=*`)
  },

  async create(businessId, debt) {
    return sbFetch('debts', {
      method: 'POST',
      body: JSON.stringify({ ...debt, business_id: businessId }),
    })
  },

  async update(debtId, businessId, updates) {
    return sbFetch(`debts?id=eq.${debtId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },
}