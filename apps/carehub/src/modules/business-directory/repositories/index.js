import { sbFetch } from '../../../services/supabase'
import { pagedQuery } from '../../../lib/pagedQuery'
import { boundingBox } from '../services/distance'
import { deriveNormalized } from '../services/normalize'
import { PLATFORM } from '../services/constants'

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

// Two scopes share the same tables (sql/20261012): a company's private directory
// (business_id = its id) and the PLATFORM registry (business_id IS NULL). Since
// carehub_20261208 the whole directory is readable and writable by platform admins
// only; a company reaches it through nearbyBusinesses() and nothing else. Pass
// PLATFORM where a business id is expected to address the platform registry.
export { PLATFORM }
const scope = (id) => (id === PLATFORM ? 'business_id=is.null' : `business_id=eq.${id}`)
const ownerOf = (id) => (id === PLATFORM ? null : id)

// PostgREST filter values are comma/paren delimited. Stripping those (and the
// wildcard `*`) from user text keeps a search box from injecting extra filters.
const clean = (s) => String(s ?? '').replace(/[(),*%\\]/g, ' ').replace(/\s+/g, ' ').trim()

export function createDirectoryRepository(request = sbFetch) {
  return {
    // ── Categories ──────────────────────────────────────────────────────────
    async getCategories(businessId, { includeInactive = false } = {}) {
      const active = includeInactive ? '' : '&is_active=eq.true'
      const who = businessId === PLATFORM ? 'business_id.is.null' : `business_id.is.null,business_id.eq.${businessId}`
      return request(`directory_categories?or=(${who})${active}&order=sort_order.asc,name.asc&select=*`)
    },

    async addCategory(businessId, { name, kind = 'other', sort_order = 1000 }) {
      const rows = await request('directory_categories', {
        method: 'POST',
        body: JSON.stringify({ business_id: businessId, name: clean(name), kind, sort_order }),
      })
      return rows[0]
    },

    async updateCategory(id, businessId, updates) {
      return request(`directory_categories?id=eq.${id}&${scope(businessId)}`, {
        method: 'PATCH', body: JSON.stringify(updates), prefer: 'return=minimal',
      })
    },

    async getSubcategories(businessId) {
      const who = businessId === PLATFORM ? 'business_id.is.null' : `business_id.is.null,business_id.eq.${businessId}`
      return request(`directory_subcategories?or=(${who})&is_active=eq.true&order=name.asc&select=*`)
    },

    async addSubcategory(businessId, categoryId, name) {
      const rows = await request('directory_subcategories', {
        method: 'POST',
        body: JSON.stringify({ business_id: ownerOf(businessId), category_id: categoryId, name: clean(name) }),
      })
      return rows[0]
    },

    // Find-or-create by (category, name) — used by the importer.
    async ensureSubcategory(businessId, categoryId, name) {
      const existing = await request(`directory_subcategories?category_id=eq.${categoryId}&${scope(businessId)}&select=*`)
      const hit = (existing || []).find((s) => s.name.trim().toLowerCase() === clean(name).toLowerCase())
      if (hit && hit.is_active === false) {
        await this.updateSubcategory(hit.id, businessId, { is_active: true })
        return { ...hit, is_active: true }
      }
      return hit || this.addSubcategory(businessId, categoryId, name)
    },

    async updateSubcategory(id, businessId, updates) {
      return request(`directory_subcategories?id=eq.${id}&${scope(businessId)}`, {
        method: 'PATCH', body: JSON.stringify(updates), prefer: 'return=minimal',
      })
    },

    // ── Businesses ──────────────────────────────────────────────────────────
    // Lean snapshot for duplicate detection. Includes inactive rows on purpose:
    // re-importing a deactivated business must not silently create a twin.
    async getDedupIndexRows(businessId) {
      return pagedQuery(request, `directory_businesses?${scope(businessId)}&order=id.asc&select=${INDEX_COLUMNS}`, { pageSize: PAGE })
    },

    async getById(id, businessId) {
      const rows = await request(`directory_businesses?id=eq.${id}&${scope(businessId)}&select=*`)
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
      const p = [scope(businessId)]
      applyFilters(p, filters)
      return request(`directory_businesses?${p.join('&')}&order=${order},id.asc&limit=${pageSize + (probe ? 1 : 0)}&offset=${page * pageSize}&select=*`)
    },

    /** Everything matching (for export) — pages through PostgREST's row cap. */
    async listAll(businessId, filters = {}) {
      const p = [scope(businessId)]
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
        scope(businessId),
        `latitude=gte.${b.minLat}`, `latitude=lte.${b.maxLat}`,
        `longitude=gte.${b.minLng}`, `longitude=lte.${b.maxLng}`,
      ]
      applyFilters(p, { ...filters, active: filters.active || 'active' })
      return request(`directory_businesses?${p.join('&')}&order=id.asc&limit=${limit}&select=*`)
    },

    /** Text-only fallback when a place cannot be geocoded: match state/LGA/city by name. */
    async searchByPlaceName(businessId, place, filters = {}, { limit = 500 } = {}) {
      const t = clean(place)
      const p = [scope(businessId)]
      if (t) p.push(`or=(state.ilike.*${q(t)}*,lga.ilike.*${q(t)}*,city.ilike.*${q(t)}*,address.ilike.*${q(t)}*)`)
      applyFilters(p, { ...filters, active: filters.active || 'active' })
      return request(`directory_businesses?${p.join('&')}&order=name_normalized.asc,id.asc&limit=${limit}&select=*`)
    },

    async create(businessId, rec, createdBy) {
      const rows = await request('directory_businesses', {
        method: 'POST',
        body: JSON.stringify(shape(ownerOf(businessId), rec, { created_by: createdBy || null })),
      })
      return rows[0]
    },

    async insertMany(businessId, batchId, recs) {
      if (!recs.length) return []
      return request('directory_businesses', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify(recs.map((r) => shape(ownerOf(businessId), r, { import_batch_id: batchId, data_source: r.data_source || 'import' }))),
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
      return request(`directory_businesses?id=eq.${id}&${scope(businessId)}`, {
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

    // ── Live Field Report suggestion (the one thing a company keeps) ────────
    // Directory tables are platform-admin only (carehub_20261208). This is a bounded
    // SECURITY DEFINER function: verified platform listings within 1 km, at most 10,
    // name / address / type / verification / distance and no contact details.
    async nearbyBusinesses({ lat, lng, radiusKm, limit }) {
      return request('rpc/nearby_directory_businesses', {
        method: 'POST', body: JSON.stringify({ p_lat: lat, p_lng: lng, p_radius_km: radiusKm, p_limit: limit }),
      })
    },

    // ── Import batches ─────────────────────────────────────────────────────
    async createBatch(businessId, fields) {
      const rows = await request('directory_import_batches', {
        method: 'POST', body: JSON.stringify({ ...fields, business_id: businessId, status: 'importing' }),
      })
      return rows[0]
    },

    async finishBatch(batchId, businessId, fields) {
      return request(`directory_import_batches?id=eq.${batchId}&${scope(businessId)}`, {
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
      return pagedQuery(request, `directory_duplicate_dismissals?${scope(businessId)}&order=a_id.asc,b_id.asc&select=a_id,b_id`, { pageSize: PAGE })
    },

    async dismissPair(businessId, idA, idB, by) {
      const [a, b] = idA < idB ? [idA, idB] : [idB, idA]
      return request('directory_duplicate_dismissals', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({ business_id: businessId, a_id: a, b_id: b, dismissed_by: by || null }),
      })
    },

    // ── Reports of incorrect information (read and resolved by the platform team) ──
    async getOpenReports(businessId) {
      return request(`directory_reports?${scope(businessId)}&status=eq.open&order=created_at.desc&select=*`)
    },

    async resolveReport(id, businessId, status = 'resolved') {
      return request(`directory_reports?id=eq.${id}&${scope(businessId)}`, {
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
  // LGA and business type are free text in the data (imports, manual entry), so match
  // case-insensitively on "contains": typing "ikeja" finds "Ikeja".
  const lga = clean(f.lga)
  if (lga) p.push(`lga=ilike.*${q(lga)}*`)
  if (f.verification) p.push(`verification_status=eq.${f.verification}`)
  if (f.source) p.push(`data_source=eq.${f.source}`)
  const bt = clean(f.businessType)
  if (bt) p.push(`business_type=ilike.*${q(bt)}*`)
  if (f.territoryId) p.push(`territory_id=eq.${f.territoryId}`)
  const active = f.active || 'active'
  if (active === 'active') p.push('is_active=eq.true')
  else if (active === 'inactive') p.push('is_active=eq.false')
  const t = clean(f.search)
  if (t) p.push(`or=(name.ilike.*${q(t)}*,address.ilike.*${q(t)}*,phone.ilike.*${q(t)}*,city.ilike.*${q(t)}*,lga.ilike.*${q(t)}*)`)
}

export const directoryRepository = createDirectoryRepository()
