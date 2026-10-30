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
const MERGE_REFUSALS = {
  MERGE_NOT_ALLOWED: 'Only the owner, or a role allowed to delete products, can merge duplicates.',
  MERGE_NOT_FOUND: 'Some of these products changed or were removed since the list loaded. Refresh and try again.',
  MERGE_LISTING_CONFLICT: 'More than one of these products has a shop listing. Remove the extra listing, then merge.',
  MERGE_TRACKED_UNSUPPORTED: 'Products tracked by batch cannot be merged here yet.',
  MERGE_INVALID: 'A service cannot be merged with a stocked product.',
  INSUFFICIENT_STOCK: 'Their combined stock would be below zero. Count the stock and correct it first.',
  E_COMMERCE_NOT_APPROVED: 'A shop listing cannot be moved until online shop access is approved.',
}

export function translateMergeError(error) {
  const code = Object.keys(MERGE_REFUSALS).find((c) => (error?.message || '').includes(c))
  if (!code) return error
  const friendly = new Error(MERGE_REFUSALS[code])
  friendly.code = code
  return friendly
}

const RECEIVE_REFUSALS = {
  BATCH_REQUIRED: 'This product is tracked by batch. Enter its batch number.',
  EXPIRY_REQUIRED: 'This product is tracked by batch and expiry. Enter the expiry date.',
  PRODUCT_NOT_FOUND: 'This product no longer exists in your inventory.',
  RECEIVE_INVALID: 'Enter a whole number of units above 0.',
}

// Same contract as translateMergeError: only the function's own refusal codes
// become sentences (with `.code` kept); anything else is rethrown untouched.
export function translateReceiveError(error) {
  const code = Object.keys(RECEIVE_REFUSALS).find((c) => (error?.message || '').includes(c))
  if (!code) return error
  const friendly = new Error(RECEIVE_REFUSALS[code])
  friendly.code = code
  return friendly
}

export function createProductRepository(request = sbFetch) {
  return {
    // PostgREST clamps every response to db-max-rows (1000 on this project —
    // proven live 2026-08-11: a `limit=50000` request for products came back
    // `Content-Range: 0-999/12276`, so 11,276 rows were unreachable through a
    // single query, which is why uploaded products past 1000 never appeared).
    // A raised limit cannot help; the rows are fetched by offset-paging until
    // the last short page. `id.asc` pins the order so pages cannot shift rows.
    // The UI paginates the returned array for rendering. `onProgress(count)`
    // reports rows loaded so far, page by page.
    async getAll(businessId, { onProgress } = {}) {
      return pagedQuery(request, `products?business_id=eq.${businessId}&order=name.asc,id.asc&select=*`, { onPage: onProgress })
    },

    // Counts for a summary card (e.g. one per branch on Locations) without the
    // full rows: only the three columns the counts need, paged. About 20x less
    // data than getAll for a large catalog.
    async getStockSummary(businessId) {
      const rows = await pagedQuery(request, `products?business_id=eq.${businessId}&order=id.asc&select=id,stock,reorder_level,category`)
      const lowStock = rows.filter(p => p.category !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5)).length
      return { productCount: rows.length, lowStock }
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

    // Returns the saved row (or null when nothing matched — wrong tenant or a
    // deleted product) so callers can update their local list from what the
    // database actually stored instead of re-downloading the catalog.
    async update(productId, businessId, updates) {
      const rows = await request(`products?id=eq.${productId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=representation',
      })
      return Array.isArray(rows) ? rows[0] || null : rows || null
    },

    async delete(productId, businessId) {
      return request(`products?id=eq.${productId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // NOTE: a `deleteBulk` used to live here for the duplicate cleanup. A bare
    // DELETE of duplicate products cascaded their reviews, shop listing and
    // stock-count history away and failed on any with batches or orders, so
    // the cleanup now merges through mergeDuplicates() and deleteBulk had no
    // callers left. Removed rather than kept as a trap.

    // Adds received units through receive_stock (carehub_20261223), which
    // writes them through the stock ledger (apply_stock_change) in one
    // transaction: the product is locked, a tracked product must name a batch
    // (and expiry), the batch is created when given, and a stock_movements row
    // records who added what, from where. Returns { stock, batch_id,
    // movement_id, replayed, skipped }.
    //
    // `idempotencyKey` is required and must identify the user's intent, not
    // the request: the same key replayed (a retry after a network failure, a
    // second tap) returns the first result and adds nothing. This replaces
    // increment_product_stock, which wrote products.stock directly and left
    // no ledger row.
    //
    // SECURITY INVOKER: products/stock RLS is the tenant boundary, the same
    // authority the old RPC had.
    async receiveStock(businessId, productId, qty, {
      movementType, idempotencyKey, sourceType = null, sourceId = null, sourceLineId = null,
      reason = null, batchNumber = null, expiryDate = null, dateReceived = null, supplier = null,
    }) {
      try {
        const result = await request('rpc/receive_stock', {
          method: 'POST',
          body: JSON.stringify({
            p_business_id: businessId,
            p_product_id: productId,
            p_qty: qty,
            p_movement_type: movementType,
            p_idempotency_key: idempotencyKey,
            p_source_type: sourceType,
            p_source_id: sourceId,
            p_source_line_id: sourceLineId,
            p_reason: reason,
            p_batch_number: batchNumber || null,
            p_expiry_date: expiryDate || null,
            p_date_received: dateReceived || null,
            p_supplier: supplier || null,
          }),
        })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateReceiveError(e)
      }
    },

    // Merges duplicates into one keeper via merge_duplicate_products
    // (20261220_merge_duplicate_products.sql), in ONE database transaction:
    // each duplicate's CURRENT stock moves into the keeper through the stock
    // ledger, every row pointing at a duplicate (batches, orders, reviews, shop
    // listing, stock counts) is repointed, then the duplicates are deleted.
    // Returns { keeper_id, merged, units_moved, stock }.
    //
    // The function's refusals carry a code; only those are translated into a
    // sentence for the toast (the error keeps `.code`). Anything unrecognised,
    // a network failure above all, is rethrown untouched, as lib/dbErrors.js
    // asks: a transport error must never be flattened into a confident, wrong
    // reason.
    async mergeDuplicates(businessId, keeperId, duplicateIds) {
      try {
        const result = await request('rpc/merge_duplicate_products', {
          method: 'POST',
          body: JSON.stringify({
            p_business_id: businessId,
            p_keeper_id: keeperId,
            p_duplicate_ids: duplicateIds,
          }),
        })
        return Array.isArray(result) ? result[0] : result
      } catch (e) {
        throw translateMergeError(e)
      }
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