import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'

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
    // PostgREST clamps every response to db-max-rows (1000 on this project —
    // proven live 2026-08-11: a `limit=50000` request for products came back
    // `Content-Range: 0-999/12276`, so 11,276 rows were unreachable through a
    // single query, which is why uploaded products past 1000 never appeared).
    // A raised limit cannot help; the rows are fetched by offset-paging until
    // the last short page. `id.asc` pins the order so pages cannot shift rows.
    // The UI paginates the returned array for rendering.
    async getAll(businessId) {
      return pagedQuery(request, `products?business_id=eq.${businessId}&order=name.asc,id.asc&select=*`)
    },

    async getById(productId, businessId) {
      const results = await request(`products?id=eq.${productId}&business_id=eq.${businessId}&select=*`)
      return results[0] || null
    },

    // Type-ahead lookup for consultation forms: matches the brand name OR the
    // generic name, case-insensitively. The query is URL-encoded before it is
    // interpolated so a product name containing a comma cannot break the
    // or=() clause structure. Selects only what pickers render — an earlier
    // service-layer version selected a nonexistent `sku` column, which made
    // every search fail with PGRST204 (swallowed by the caller's catch).
    async search(businessId, query, limit = 30) {
      const q = encodeURIComponent(query.trim())
      if (!q) return []
      return request(
        `products?business_id=eq.${businessId}` +
        `&or=(name.ilike.*${q}*,generic_name.ilike.*${q}*)` +
        `&order=name.asc,id.asc&select=id,name,generic_name,price,category&limit=${limit}`,
      )
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

    // Atomic replenishment via the increment_product_stock RPC (C5/C12,
    // 20260804_sale_stock_movement.sql). Purchases used to read stock, add the
    // quantity in JavaScript and write an absolute value back — against the
    // sale_stock_movement trigger that is a lost update, so recording a
    // purchase while a till sold the same product silently restored the sold
    // units. The RPC does `stock = stock + qty` inside the database instead.
    //
    // The RPC is SECURITY INVOKER, so products' RLS still scopes it; passing
    // businessId keeps the filter explicit on this side too.
    async incrementStock(productId, businessId, qty) {
      if (!qty || qty <= 0) return null
      const result = await request('rpc/increment_product_stock', {
        method: 'POST',
        body: JSON.stringify({
          p_product_id: productId,
          p_business_id: businessId,
          p_qty: qty,
        }),
      })
      // PostgREST returns the scalar the function returns — the new stock
      // level, or null when no row matched (wrong tenant, deleted product).
      return Array.isArray(result) ? result[0] : result
    },

    // NOTE: `getStockBatches`/`addStockBatch` used to live here too. They had
    // zero callers and zero test coverage, and they reached into
    // `stock_batches` — a table the stock module owns — with a different
    // ordering (expiry_date vs created_at) than the functions the app actually
    // used. Removed when `stock` adopted the seam; batches belong to
    // modules/stock/repositories.

    // NOTE: a previous `updateStock` issued an unscoped PATCH with a
    // `{ stock: { increment } }` body PostgREST does not honour — it was dead
    // and would have corrupted every row's stock. Removed. Stock changes go
    // through update() with a read-modify-written value. A truly atomic
    // increment needs a Postgres RPC (out of scope for this pilot).
  }
}

export const productRepository = createProductRepository()

// This file now holds only the product aggregate. The expense, purchase and
// debt repositories that used to sit here — misplaced, and in the latter two
// cases never imported by anything — have moved to the modules that own those
// aggregates: modules/expenses, modules/purchases and modules/debts.