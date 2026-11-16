import { sbFetch } from '../../../services/supabase'
import { isMissingObject } from '../../../lib/dbErrors'

// ── Product library repository (carehub_20261223) ────────────────────────────
// The shared CareHub product library: one row per real product, curated by
// CareHub admins. Approved items are readable by everyone; every change is a
// database function that checks who is asking:
//   admin*   — CareHub platform admins only (review, edit, merge, import, seed, decide suggestions);
//   link / unlink / suggest — the owner or a manager of the main business.
// Before the migration is applied, reads report `available: false` and
// searches return nothing, so screens can say so instead of failing.
export const PAGE_SIZE = 50

export function createLibraryRepository(request = sbFetch) {
  const post = (name, body) => request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })
  const scalar = async (name, body) => {
    const rows = await post(name, body)
    return Array.isArray(rows) ? rows[0] : rows
  }
  const unavailable = (e, value) => { if (isMissingObject(e)) return value; throw e }

  return {
    // ── For businesses ──────────────────────────────────────────────────────
    // Approved items matching a name, generic name or barcode (best first).
    async search(query, limit = 20) {
      if (String(query || '').trim().length < 2) return []
      try {
        return ((await post('catalog_search', { p_query: String(query).trim(), p_limit: limit })) || []).map((r) => r.item)
      } catch (e) { return unavailable(e, []) }
    },

    // The business's unlinked items that match a library item: [{ master, library, match_by }], with `total`.
    async linkMatches(businessId, { offset = 0, limit = PAGE_SIZE } = {}) {
      try {
        const rows = (await post('catalog_link_matches', { p_business_id: businessId, p_offset: offset, p_limit: limit })) || []
        return { matches: rows.map(({ total: _total, ...r }) => r), total: rows.length ? Number(rows[0].total) : 0, available: true }
      } catch (e) { return unavailable(e, { matches: [], total: 0, available: false }) }
    },

    // links: [{ master_product_id, catalog_item_id }]. Returns how many items were linked.
    async link(businessId, links) {
      if (!links?.length) return 0
      return Number(await scalar('link_master_to_catalog', { p_business_id: businessId, p_links: links })) || 0
    },

    async unlink(businessId, masterProductId) {
      return scalar('unlink_master_from_catalog', { p_business_id: businessId, p_master_product_id: masterProductId })
    },

    async suggest(businessId, masterProductId, note = '') {
      return scalar('suggest_catalog_item', { p_business_id: businessId, p_master_product_id: masterProductId, p_note: note || null })
    },

    // ── For CareHub admins ──────────────────────────────────────────────────
    // One page of the library by status ('pending', 'active', 'retired'), most widely used first.
    async adminPage({ status = 'pending', source = null, search = '', offset = 0, limit = PAGE_SIZE } = {}) {
      try {
        const rows = (await post('admin_catalog_page', { p_status: status, p_source: source || null, p_search: search || null, p_offset: offset, p_limit: limit })) || []
        return { items: rows.map((r) => ({ ...r.item, linked: Number(r.linked) || 0 })), total: rows.length ? Number(rows[0].total) : 0, available: true }
      } catch (e) { return unavailable(e, { items: [], total: 0, available: false }) }
    },

    // Creates (id null) or updates an item. Returns the item.
    async save(id, fields) {
      return scalar('admin_save_catalog_item', { p_id: id || null, p_fields: fields })
    },

    // action: 'approve' | 'retire' | 'reopen'. Returns how many items changed.
    async review(ids, action, note = '') {
      if (!ids?.length) return 0
      return Number(await scalar('admin_review_catalog_items', { p_ids: ids, p_action: action, p_note: note || null })) || 0
    },

    async merge(keepId, dropId) {
      return Number(await scalar('admin_merge_catalog_items', { p_keep: keepId, p_drop: dropId })) || 0
    },

    // Up to 1000 rows; returns { inserted, updated, skipped, errors: [{ row, reason }] }.
    async importRows(rows) {
      return scalar('admin_import_catalog_items', { p_rows: rows })
    },

    async seed(minBusinesses = 2) {
      return Number(await scalar('admin_seed_catalog_candidates', { p_min: minBusinesses })) || 0
    },

    // Suggestions by status, newest first: [{ ...suggestion, business_name, existing }], with `total`.
    async suggestions({ status = 'pending', offset = 0, limit = PAGE_SIZE } = {}) {
      try {
        const rows = (await post('admin_catalog_suggestions', { p_status: status, p_offset: offset, p_limit: limit })) || []
        return { suggestions: rows.map((r) => ({ ...r.suggestion, business_name: r.business_name, existing: r.existing })), total: rows.length ? Number(rows[0].total) : 0, available: true }
      } catch (e) { return unavailable(e, { suggestions: [], total: 0, available: false }) }
    },

    // action: 'create' (with the admin's fields) | 'link' (to catalogItemId) | 'reject' (with a note).
    async decide(suggestionId, action, { catalogItemId = null, fields = null, note = '' } = {}) {
      return scalar('admin_decide_catalog_suggestion', {
        p_id: suggestionId, p_action: action, p_catalog_item_id: catalogItemId, p_fields: fields, p_note: note || null,
      })
    },
  }
}

export const libraryRepository = createLibraryRepository()
