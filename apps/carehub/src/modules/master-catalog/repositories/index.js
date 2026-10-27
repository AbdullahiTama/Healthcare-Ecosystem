import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { isMissingObject } from '../../../lib/dbErrors'

// ── Master catalog repository (ADR-004, Product-Catalogue-Design.md) ─────────
// A deep module over `master_products` (the business's own product list, the
// home of every product) and `branch_products` (which branches carry what).
// Since carehub_20261215 every branch product points at its master item by id
// (products.master_product_id); nothing is matched by name any more.
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
export const PAGE_SIZE = 50

export function createMasterCatalogRepository(request = sbFetch) {
  const rpc = async (name, body) => {
    const rows = await request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })
    return Array.isArray(rows) ? rows[0] : rows
  }

  const repo = {
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

    // ── The Master Catalog screen ────────────────────────────────────────────
    // One page of items, each with `carried`: the products linked to it at
    // each location ({ branch_id, product_id, price, stock, price_source,
    // active }). `upgraded` is false before carehub_20261215 is applied: the
    // plain list is filtered here, and branch details are not available.
    async getPage(businessId, { search = '', category = null, rx = null, archived = false, offset = 0, limit = PAGE_SIZE } = {}) {
      try {
        const rows = (await request('rpc/master_catalog_page', {
          method: 'POST',
          body: JSON.stringify({
            p_business_id: businessId, p_search: search || null, p_category: category || null, p_rx: rx || null,
            p_archived: !!archived, p_offset: offset, p_limit: limit,
          }),
        })) || []
        return {
          items: rows.map((r) => ({ ...r.item, carried: r.carried || [] })),
          total: rows.length ? Number(rows[0].total) : 0,
          upgraded: true,
        }
      } catch (e) {
        if (!isMissingObject(e)) throw e
        if (archived || category || rx) return { items: [], total: 0, upgraded: false }
        const term = search.trim().toLowerCase()
        const all = (await repo.getAll(businessId)).filter((m) => !term || m.name?.toLowerCase().includes(term))
        return { items: all.slice(offset, offset + limit).map((m) => ({ ...m, carried: [] })), total: all.length, upgraded: false }
      }
    },

    // The standard categories (code, label, default prescription status), in
    // display order. Empty before carehub_20261215.
    async getCategories() {
      try {
        return (await request('product_categories?select=code,label,rx_default&order=sort.asc')) || []
      } catch (e) {
        if (isMissingObject(e)) return []
        throw e
      }
    },

    // Carries master items at a branch in one call: creates the branch's
    // product at stock 0 where it has none, and restarts a stopped one.
    // `price`, when given, becomes that branch's own price for every item.
    // Returns how many items are now carried. Before carehub_20261215 it falls
    // back to one activate_branch_product call per item.
    async carry(branchId, masterIds, price = null) {
      if (!branchId || !masterIds?.length) return 0
      try {
        const n = await rpc('carry_master_items', { p_branch_id: branchId, p_master_ids: masterIds, p_price: price ?? null })
        return Number(n) || 0
      } catch (e) {
        if (!isMissingObject(e)) throw e
        for (const id of masterIds) await repo.activate(branchId, id, price ? Math.round(price) : null)
        return masterIds.length
      }
    },

    // Archiving hides an item from the catalogue and stops new links by name;
    // branches keep their products, stock and history. Restoring brings it
    // back. Used instead of delete, which the carrying links would block.
    async archive(masterProductId, businessId) {
      return repo.update(masterProductId, businessId, { archived_at: new Date().toISOString() })
    },

    async restore(masterProductId, businessId) {
      return repo.update(masterProductId, businessId, { archived_at: null })
    },

    // Deletes a master item. The database refuses it while any branch
    // carries the item (branch_products has no cascade), so the screen
    // archives instead; this stays for items nobody carries.
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
      return rpc('activate_branch_product', {
        p_branch_id: branchId,
        p_master_product_id: masterProductId,
        p_override_price: overridePrice || null,
      })
    },

    // Stops carrying an item at a branch. The branch keeps its product and
    // stock; the catalogue shows it as stopped.
    async deactivate(branchId, masterProductId) {
      return rpc('deactivate_branch_product', { p_branch_id: branchId, p_master_product_id: masterProductId })
    },

    // Sends the item's name, generic name, category, barcode and prescription
    // status to every linked product, by id; the price reaches only products
    // that follow the master price (a branch's own price is kept). Returns how
    // many products were updated.
    async push(masterProductId, businessId) {
      return rpc('push_master_product', { p_master_product_id: masterProductId, p_business_id: businessId })
    },
  }
  return repo
}

export const masterCatalogRepository = createMasterCatalogRepository()
