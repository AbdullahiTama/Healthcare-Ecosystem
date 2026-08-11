import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'

// ── Master catalog repository (ADR-004) ──────────────────────────────────────
// A deep module over `master_products` (the owner's canonical list) and
// `branch_products` (which branches carry what, at what price override).
//
// The write operations are NOT client-side multi-table sequences — they are
// RPCs (activate/deactivate/push) that run atomically inside the database and
// keep the branch's sellable `products` row in step with the link. The
// repository's job is to own the RPC call shapes and, above all, tenant
// scoping: every read is filtered by business_id, and every RPC passes the
// ids so the server-side current_business_ids() check is explicit.
//
// The only outside dependency is `request`, with sbFetch's shape —
// (path, options) => Promise<rows>. Production binds the real transport
// (default), tests bind the in-memory adapter.
export function createMasterCatalogRepository(request = sbFetch) {
  return {
    // ── Master products ──────────────────────────────────────────────────────
    // Scoped to the PARENT business: branches do not own master rows, so the
    // page always passes `brand.parent_business_id || brand.id`. Paged like
    // every tenant collection (PostgREST clamps responses at 1000 rows).
    async getAll(businessId) {
      return pagedQuery(request, `master_products?business_id=eq.${businessId}&order=name.asc,id.asc&select=*`)
    },

    async getById(masterProductId, businessId) {
      const rows = await request(`master_products?id=eq.${masterProductId}&business_id=eq.${businessId}&select=*`)
      return rows[0] || null
    },

    async create(businessId, masterProduct) {
      return request('master_products', {
        method: 'POST',
        body: JSON.stringify({ ...masterProduct, business_id: businessId }),
      })
    },

    async update(masterProductId, businessId, updates) {
      return request(`master_products?id=eq.${masterProductId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Deleting a master product cascades to its branch_products links (the
    // migration's ON DELETE CASCADE); branch products rows are untouched —
    // a branch keeps selling what stock it has, it just stops receiving
    // pushes.
    async remove(masterProductId, businessId) {
      return request(`master_products?id=eq.${masterProductId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── Activation links ─────────────────────────────────────────────────────
    // Paged too: a branch carrying more than 1000 master products would
    // otherwise have its links truncated by the response clamp.
    async getLinks(branchId) {
      return pagedQuery(request, `branch_products?branch_id=eq.${branchId}&order=id.asc&select=*`)
    },

    async activate(branchId, masterProductId, overridePrice) {
      const rows = await request('rpc/activate_branch_product', {
        method: 'POST',
        body: JSON.stringify({
          p_branch_id: branchId,
          p_master_product_id: masterProductId,
          p_override_price: overridePrice || null,
        }),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },

    async deactivate(branchId, masterProductId) {
      const rows = await request('rpc/deactivate_branch_product', {
        method: 'POST',
        body: JSON.stringify({
          p_branch_id: branchId,
          p_master_product_id: masterProductId,
        }),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },

    // Pushes name/category/price to every branch with an ACTIVE link; price
    // only reaches branches that have not set their own override.
    async push(masterProductId, businessId) {
      const rows = await request('rpc/push_master_product', {
        method: 'POST',
        body: JSON.stringify({
          p_master_product_id: masterProductId,
          p_business_id: businessId,
        }),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },
  }
}

export const masterCatalogRepository = createMasterCatalogRepository()
