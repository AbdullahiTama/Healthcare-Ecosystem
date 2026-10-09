import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { boundingBox } from '../services/distance'
import { deriveNormalized } from '../services/normalize'

// ── Business Directory repository ─────────────────────────────────────────────
// Deep module over directory_categories, directory_subcategories,
// directory_businesses, directory_import_batches/_errors and directory_reports.
// Same seam as the other repositories: the only dependency is `request`, a
// function shaped like sbFetch (production binds sbFetch, tests bind the
// in-memory client).
//
// TENANCY: every directory table carries business_id and every query here
// filters on it — the database's RLS is the real boundary, this is the second
// lock. Categories are the one exception: business_id NULL is the built-in set
// shared by everyone, so category reads are `or=(business_id.is.null,…)`.
//
// The columns the duplicate engine and search need — and nothing else — are
// listed once so a 20,000-record index load does not drag descriptions along.
const INDEX_COLUMNS = 'id,name,name_normalized,category_id,address_normalized,phone_normalized,website_host,latitude,longitude,is_active'

const q = encodeURIComponent
const PAGE = 1000

// PostgREST filter values are comma/paren delimited. Stripping those (and the
// wildcard `*`) from user text keeps a search box from injecting extra filters.
const clean = (s) => String(s ?? '').replace(/[(),*%\\]/g, ' ').replace(/\s+/g, ' ').trim()

export function createDirectoryRepository(request = sbFetch) {
  return {
    // ── Categories ──────────────────────────────────────────────────────────
    async getCategories(businessId, { includeInactive = false } = {}) {
      const active = includeInactive ? '' : '&is_active=eq.true'
      return request(`directory_categories?or=(business_id.is.null,business_id.eq.${businessId})${active}&order=sort_order.asc,name.asc&select=*`)
    },

    async addCategory(businessId, { name, kind = 'other', sort_order = 1000 }) {
      const rows = await request('directory_categories', {
        method: 'POST',
        body: JSON.stringify({ business_id: businessId, name: clean(name), kind, sort_order }),
      })
      return rows[0]
    },

    async updateCategory(id, businessId, updates) {
      return request(`directory_categories?id=eq.${id}&business_id=eq.${businessId}`, {
        method: 'PATCH', body: JSON.stringify(updates), prefer: 'return=minimal',
      })
    },

    async getSubcategories(businessId) {
      return request(`directory_subcategories?or=(business_id.is.null,business_id.eq.${businessId})&is_active=eq.true&order=name.asc&select=*`)
    },

    async addSubcategory(businessId, categoryId, name) {
      const rows = await request('directory_subcategories', {
        method: 'POST',
        body: JSON.stringify({ business_id: businessId, category_id: categoryId, name: clean(name) }),
      })
      return rows[0]
    },

    // Find-or-create by (category, name) — used by the importer.
    async ensureSubcategory(businessId, categoryId, name) {
      const existing = await request(`directory_subcategories?category_id=eq.${categoryId}&business_id=eq.${businessId}&select=*`)
      const hit = (existing || []).find((s) => s.name.trim().toLowerCase() === clean(name).toLowerCase())
      if (hit && hit.is_active === false) {
        await this.updateSubcategory(hit.id, businessId, { is_active: true })
        return { ...hit, is_active: true }
      }
      return hit || this.addSubcategory(businessId, categoryId, name)
    },

    async updateSubcategory(id, businessId, updates) {
      return request(`directory_subcategories?id=eq.${id}&business_id=eq.${businessId}`, {
        method: 'PATCH', body: JSON.stringify(updates), prefer: 'return=minimal',
      })
    },

    // ── Businesses ──────────────────────────────────────────────────────────
    // Lean snapshot for duplicate detection. Includes inactive rows on purpose:
    // re-importing a deactivated business must not silently create a twin.
    async getDedupIndexRows(businessId) {
      return pagedQuery(request, `directory_businesses?business_id=eq.${businessId}&order=id.asc&select=${INDEX_COLUMNS}`, { pageSize: PAGE })
    },

    async getById(id, businessId) {
      const rows = await request(`directory_businesses?id=eq.${id}&business_id=eq.${businessId}&select=*`)
      return rows[0] || null
    },

    /**
     * One filtered page for the admin table.
     * filters: {search, categoryId, subcategoryId, state, lga, verification, source, active ('active'|'inactive'|'all')}
     * Returns {rows} (the caller pages with page/pageSize).
     */
    // `probe` fetches one row past the page so the caller can tell whether a
    // next page exists without a COUNT query (the offset stride stays pageSize).
    async list(businessId, filters = {}, { page = 0, pageSize = 50, order = 'created_at.desc', probe = false } = {}) {
      const p = [`business_id=eq.${businessId}`]
      applyFilters(p, filters)
      return request(`directory_businesses?${p.join('&')}&order=${order},id.asc&limit=${pageSize + (probe ? 1 : 0)}&offset=${page * pageSize}&select=*`)
    },

    /** Everything matching (for export) — pages through PostgREST's row cap. */
    async listAll(businessId, filters = {}) {
      const p = [`business_id=eq.${businessId}`]
      applyFilters(p, filters)
      return pagedQuery(request, `directory_businesses?${p.join('&')}&order=name_normalized.asc,id.asc&select=*`, { pageSize: PAGE })
    },

    /**
     * Candidates for a radius search: a lat/lng rectangle (index-friendly) plus
     * the same attribute filters. The caller trims the corners with haversine.
     */
    async searchWithinBox(businessId, { lat, lng, radiusKm }, filters = {}, { limit = 2000 } = {}) {
      const b = boundingBox(lat, lng, radiusKm)
      const p = [
        `business_id=eq.${businessId}`,
        `latitude=gte.${b.minLat}`, `latitude=lte.${b.maxLat}`,
        `longitude=gte.${b.minLng}`, `longitude=lte.${b.maxLng}`,
      ]
      applyFilters(p, { ...filters, active: filters.active || 'active' })
      return request(`directory_businesses?${p.join('&')}&order=id.asc&limit=${limit}&select=*`)
    },

    /** Text-only fallback when a place cannot be geocoded: match state/LGA/city by name. */
    async searchByPlaceName(businessId, place, filters = {}, { limit = 500 } = {}) {
      const t = clean(place)
      const p = [`business_id=eq.${businessId}`]
      if (t) p.push(`or=(state.ilike.*${q(t)}*,lga.ilike.*${q(t)}*,city.ilike.*${q(t)}*,address.ilike.*${q(t)}*)`)
      applyFilters(p, { ...filters, active: filters.active || 'active' })
      return request(`directory_businesses?${p.join('&')}&order=name_normalized.asc,id.asc&limit=${limit}&select=*`)
    },

    async create(businessId, rec, createdBy) {
      const rows = await request('directory_businesses', {
        method: 'POST',
        body: JSON.stringify(shape(businessId, rec, { created_by: createdBy || null })),
      })
      return rows[0]
    },

    async insertMany(businessId, batchId, recs) {
      if (!recs.length) return []
      return request('directory_businesses', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify(recs.map((r) => shape(businessId, r, { import_batch_id: batchId, data_source: r.data_source || 'import' }))),
      })
    },

    async update(id, businessId, updates) {
      const next = { ...updates }
      if ('name' in next || 'address' in next || 'phone' in next || 'website' in next) {
        // Re-derive only the normalised columns whose source field is being written.
        const d = deriveNormalized(next)
        if ('name' in next) next.name_normalized = d.name_normalized
        if ('address' in next) next.address_normalized = d.address_normalized
        if ('phone' in next) next.phone_normalized = d.phone_normalized
        if ('website' in next) next.website_host = d.website_host
      }
      return request(`directory_businesses?id=eq.${id}&business_id=eq.${businessId}`, {
        method: 'PATCH', body: JSON.stringify(next), prefer: 'return=minimal',
      })
    },

    // Directory records are never hard-deleted from the UI: they may be referenced by field activity.
    async setActive(id, businessId, isActive) {
      return this.update(id, businessId, { is_active: !!isActive })
    },

    async setVerification(id, businessId, status) {
      return this.update(id, businessId, { verification_status: status })
    },

    // ── Import batches ─────────────────────────────────────────────────────
    async createBatch(businessId, fields) {
      const rows = await request('directory_import_batches', {
        method: 'POST', body: JSON.stringify({ ...fields, business_id: businessId, status: 'importing' }),
      })
      return rows[0]
    },

    async finishBatch(batchId, businessId, fields) {
      return request(`directory_import_batches?id=eq.${batchId}&business_id=eq.${businessId}`, {
        method: 'PATCH', body: JSON.stringify({ ...fields, completed_at: new Date().toISOString() }), prefer: 'return=minimal',
      })
    },

    async getBatches(businessId, limit = 20) {
      return request(`directory_import_batches?business_id=eq.${businessId}&order=created_at.desc&limit=${limit}&select=*`)
    },

    async addImportErrors(businessId, batchId, errors) {
      if (!errors.length) return []
      return request('directory_import_errors', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify(errors.map((e) => ({ ...e, batch_id: batchId, business_id: businessId }))),
      })
    },

    // ── Duplicate review ───────────────────────────────────────────────────
    async getDismissedPairs(businessId) {
      return pagedQuery(request, `directory_duplicate_dismissals?business_id=eq.${businessId}&order=a_id.asc,b_id.asc&select=a_id,b_id`, { pageSize: PAGE })
    },

    async dismissPair(businessId, idA, idB, by) {
      const [a, b] = idA < idB ? [idA, idB] : [idB, idA]
      return request('directory_duplicate_dismissals', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({ business_id: businessId, a_id: a, b_id: b, dismissed_by: by || null }),
      })
    },

    // ── Territory intelligence (read-only RPCs; see sql/20261011) ───────────
    // SECURITY INVOKER functions: the caller's RLS decides what they can see.
    async coverageSummary(businessId, since, group, { categoryId = null, state = null, unassignedOnly = false } = {}) {
      return request('rpc/directory_coverage_summary', {
        method: 'POST',
        body: JSON.stringify({ p_business_id: businessId, p_since: since, p_group: group, p_category_id: categoryId, p_state: state, p_unassigned_only: unassignedOnly }),
      })
    },

    // total_count rides on every row (window function), so one call pages and counts.
    async unvisited(businessId, since, { territoryId = null, unassignedOnly = false, state = null, categoryId = null, limit = 50, offset = 0 } = {}) {
      return request('rpc/directory_unvisited', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: businessId, p_since: since, p_territory_id: territoryId, p_unassigned_only: unassignedOnly,
          p_state: state, p_category_id: categoryId, p_limit: limit, p_offset: offset,
        }),
      })
    },

    async visitTotals(businessId, since) {
      const rows = await request('rpc/directory_visit_totals', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_since: since }) })
      return rows[0] || null
    },

    async repActivity(businessId, since) {
      return request('rpc/directory_rep_activity', { method: 'POST', body: JSON.stringify({ p_business_id: businessId, p_since: since }) })
    },

    /**
     * Bulk-assign a territory to ACTIVE businesses that have none yet, optionally
     * limited to a state. Never overwrites an existing assignment. Returns the
     * number of rows changed. (RLS limits this to directory managers.)
     */
    async assignTerritoryToUnassigned(businessId, territoryId, { state = null } = {}) {
      const p = [`business_id=eq.${businessId}`, 'is_active=eq.true', 'territory_id=is.null']
      if (state) p.push(`state=eq.${q(state)}`)
      const rows = await request(`directory_businesses?${p.join('&')}&select=id`, {
        method: 'PATCH', body: JSON.stringify({ territory_id: territoryId }),
      })
      return Array.isArray(rows) ? rows.length : 0
    },

    // ── Reports of incorrect information ───────────────────────────────────
    async reportIncorrect(businessId, directoryBusinessId, message, reportedBy) {
      return request('directory_reports', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({ business_id: businessId, directory_business_id: directoryBusinessId, message: String(message).trim(), reported_by: reportedBy || null }),
      })
    },

    async getOpenReports(businessId) {
      return request(`directory_reports?business_id=eq.${businessId}&status=eq.open&order=created_at.desc&select=*`)
    },

    async resolveReport(id, businessId, status = 'resolved') {
      return request(`directory_reports?id=eq.${id}&business_id=eq.${businessId}`, {
        method: 'PATCH', body: JSON.stringify({ status, resolved_at: new Date().toISOString() }), prefer: 'return=minimal',
      })
    },
  }
}

function shape(businessId, rec, extra = {}) {
  const d = deriveNormalized(rec)
  const out = {
    ...rec,
    ...extra,
    business_id: businessId,
    name: String(rec.name).trim(),
    name_normalized: rec.name_normalized || d.name_normalized,
    address_normalized: rec.address_normalized ?? d.address_normalized,
    phone_normalized: rec.phone_normalized ?? d.phone_normalized,
    website_host: rec.website_host ?? d.website_host,
  }
  // Server-owned columns are never client-set.
  delete out.id
  delete out.verified_at
  delete out.verified_by
  delete out.created_at
  delete out.updated_at
  return out
}

function applyFilters(p, f) {
  if (f.categoryId) p.push(`category_id=eq.${f.categoryId}`)
  if (f.subcategoryId) p.push(`subcategory_id=eq.${f.subcategoryId}`)
  if (f.state) p.push(`state=eq.${q(f.state)}`)
  if (f.lga) p.push(`lga=eq.${q(f.lga)}`)
  if (f.verification) p.push(`verification_status=eq.${f.verification}`)
  if (f.source) p.push(`data_source=eq.${f.source}`)
  if (f.businessType) p.push(`business_type=eq.${q(f.businessType)}`)
  if (f.territoryId) p.push(`territory_id=eq.${f.territoryId}`)
  const active = f.active || 'active'
  if (active === 'active') p.push('is_active=eq.true')
  else if (active === 'inactive') p.push('is_active=eq.false')
  const t = clean(f.search)
  if (t) p.push(`or=(name.ilike.*${q(t)}*,address.ilike.*${q(t)}*,phone.ilike.*${q(t)}*,city.ilike.*${q(t)}*,lga.ilike.*${q(t)}*)`)
}

export const directoryRepository = createDirectoryRepository()
