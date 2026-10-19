import { sbFetch } from '../../../services/supabase'
import { isDuplicateError } from '../../../lib/dbErrors'
import { validateDirectoryRecord, VERIFICATION_STATUSES, duplicateKeys } from '../directoryRecord'

// Directory repository: the transport seam for directory_businesses,
// directory_categories, directory_business_private and directory_audit.
// Authorisation is NOT decided here: every write is gated by RLS through
// is_directory_admin() (carehub_20261120_business_directory.sql). This layer
// validates input and shapes requests; a non-admin calling it directly gets a
// database refusal, not a silent success.

const LIST_COLUMNS =
  'id,name,category_id,subcategory_id,business_type,address,city,state,lga,latitude,longitude,' +
  'phone,email,website,verification_status,verified_at,data_source,is_active,claimed_business_id,created_at,updated_at'

// Escape LIKE wildcards in user text, then URL-encode for PostgREST.
const likeTerm = (s) => encodeURIComponent('*' + String(s).replace(/[\\%_*]/g, '\\$&') + '*')
const clampLimit = (n, max = 100) => Math.min(Math.max(parseInt(n, 10) || 25, 1), max)
const enc = encodeURIComponent

function invalid(errors) {
  const e = new Error('Invalid directory record')
  e.fields = errors
  return e
}

export function createDirectoryRepository(request = sbFetch) {
  return {
    async listCategories() {
      return request('directory_categories?order=sort_order.asc,name.asc&select=*')
    },

    // Server-side filtering and pagination; never returns the whole table.
    async search({ q, categoryId, subcategoryId, state, lga, city, verification, source, active = true, limit = 25, offset = 0 } = {}) {
      const p = []
      if (q && String(q).trim()) p.push('name=ilike.' + likeTerm(String(q).trim()))
      if (categoryId) p.push('category_id=eq.' + enc(categoryId))
      if (subcategoryId) p.push('subcategory_id=eq.' + enc(subcategoryId))
      if (state) p.push('state=ilike.' + likeTerm(state))
      if (lga) p.push('lga=ilike.' + likeTerm(lga))
      if (city) p.push('city=ilike.' + likeTerm(city))
      if (verification && VERIFICATION_STATUSES.includes(verification)) p.push('verification_status=eq.' + verification)
      if (source) p.push('data_source=eq.' + enc(source))
      if (active !== null) p.push('is_active=eq.' + (active ? 'true' : 'false'))
      p.push('order=name_normalized.asc,id.asc', 'select=' + LIST_COLUMNS,
        'limit=' + clampLimit(limit), 'offset=' + Math.max(parseInt(offset, 10) || 0, 0))
      return request('directory_businesses?' + p.join('&'))
    },

    async get(id) {
      const rows = await request('directory_businesses?id=eq.' + enc(id) + '&select=*&limit=1')
      return Array.isArray(rows) ? rows[0] || null : rows
    },

    // Throws an error carrying { fields } on invalid input, without a request.
    async create(input) {
      const v = validateDirectoryRecord(input)
      if (!v.ok) throw invalid(v.errors)
      try {
        const rows = await request('directory_businesses', { method: 'POST', body: JSON.stringify(v.record) })
        return Array.isArray(rows) ? rows[0] : rows
      } catch (e) {
        if (isDuplicateError(e)) throw new Error('This external record has already been added.')
        throw e
      }
    },

    async update(id, input) {
      const v = validateDirectoryRecord(input)
      if (!v.ok) throw invalid(v.errors)
      // Provenance is set once, at creation.
      const { data_source, source_ref, ...editable } = v.record
      const rows = await request('directory_businesses?id=eq.' + enc(id), {
        method: 'PATCH', body: JSON.stringify(editable),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },

    // Deactivate, never delete: there is no DELETE policy, by design.
    async setActive(id, isActive) {
      return request('directory_businesses?id=eq.' + enc(id), {
        method: 'PATCH', body: JSON.stringify({ is_active: !!isActive }), prefer: 'return=minimal',
      })
    },

    // The only path that changes verification; the RPC checks the caller.
    async setVerification(id, status, note) {
      if (!VERIFICATION_STATUSES.includes(status)) throw new Error('Invalid verification status')
      return request('rpc/directory_set_verification', {
        method: 'POST', body: JSON.stringify({ p_id: id, p_status: status, p_note: note || null }),
      })
    },

    // Possible duplicates by normalised name or phone. Candidates are returned
    // for a human to review; nothing is merged or overwritten here.
    async findPossibleDuplicates({ nameNormalized, phoneNormalized, excludeId } = {}) {
      const ors = []
      if (nameNormalized) ors.push('name_normalized.eq.' + enc(nameNormalized))
      if (phoneNormalized) ors.push('phone_normalized.eq.' + enc(phoneNormalized))
      if (!ors.length) return []
      let path = 'directory_businesses?or=(' + ors.join(',') + ')&select=' + LIST_COLUMNS + '&limit=20'
      if (excludeId) path += '&id=neq.' + enc(excludeId)
      return request(path)
    },

    async getPrivate(id) {
      const rows = await request('directory_business_private?directory_business_id=eq.' + enc(id) + '&select=*')
      return Array.isArray(rows) ? rows[0] || null : rows
    },

    async savePrivate(id, { contact_person, notes }) {
      return request('directory_business_private?on_conflict=directory_business_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify({
          directory_business_id: id, contact_person: contact_person || null, notes: notes || null,
          updated_at: new Date().toISOString(),
        }),
      })
    },

    async history(id, limit = 50) {
      return request('directory_audit?directory_business_id=eq.' + enc(id) +
        '&order=created_at.desc&select=id,action,actor_id,before,after,note,created_at&limit=' + clampLimit(limit, 200))
    },

    // Business Discovery: server-side filter, radius, sort and pagination via
    // the read-only directory_search RPC. `params` are built by
    // business-directory/searchQuery.buildSearchParams.
    async discover(params) {
      const res = await request('rpc/directory_search', { method: 'POST', body: JSON.stringify(params) })
      const r = Array.isArray(res) ? res[0] : res
      return { rows: [], total: 0, hasMore: false, ...(r || {}) }
    },

    // Import execution. Records come from buildImportPlan (already validated);
    // the database re-checks them. One request = one atomic batch.
    async insertBatch(records) {
      if (!Array.isArray(records) || records.length === 0) return
      if (records.length > 200) throw new Error('Batch too large')
      return request('directory_businesses', { method: 'POST', body: JSON.stringify(records), prefer: 'return=minimal' })
    },

    async insertOne(record) {
      return request('directory_businesses', { method: 'POST', body: JSON.stringify(record), prefer: 'return=minimal' })
    },

    // Existing rows an import might duplicate: exact name or phone keys, plus
    // everything in the cities the file mentions (capped), so fuzzy and
    // proximity comparison has something to compare with. Rows elsewhere with a
    // merely similar name are NOT found: that is a documented limit.
    async findCandidates(records) {
      // Also what a reviewer needs to compare field by field before a merge.
      const cols = 'id,name,name_normalized,phone_normalized,address,latitude,longitude,data_source,source_ref,verification_status,is_active,' +
        'category_id,subcategory_id,business_type,city,state,lga,phone,email,website,description'
      const names = [...new Set(records.map((r) => duplicateKeys(r).name).filter(Boolean))]
      const phones = [...new Set(records.map((r) => duplicateKeys(r).phone).filter(Boolean))]
      const cities = [...new Set(records.map((r) => r.city).filter(Boolean))].slice(0, 50)
      const out = new Map()
      const add = (rows) => (Array.isArray(rows) ? rows : []).forEach((r) => out.set(r.id, r))
      const inList = (vals) => '(' + vals.map((v) => '"' + String(v).replace(/["\\]/g, '') + '"').join(',') + ')'
      for (let i = 0; i < names.length; i += 100) {
        add(await request('directory_businesses?name_normalized=in.' + enc(inList(names.slice(i, i + 100))) + '&select=' + cols + '&limit=1000'))
      }
      for (let i = 0; i < phones.length; i += 100) {
        add(await request('directory_businesses?phone_normalized=in.' + enc(inList(phones.slice(i, i + 100))) + '&select=' + cols + '&limit=1000'))
      }
      for (const city of cities) {
        add(await request('directory_businesses?city=ilike.' + likeTerm(city) + '&select=' + cols + '&limit=1000'))
      }
      return [...out.values()]
    },

    // Merge a reviewed import row into an existing business. The database enforces
    // who may do it, which fields are allowed, that verified records are never
    // overwritten, and that the same import row merges only once.
    // changes: { field: { value, mode: 'fill' | 'overwrite' } } from buildMergeChanges.
    async mergeImportRow(targetId, sourceRef, changes) {
      if (!targetId || !sourceRef || !changes) throw new Error('Nothing to merge.')
      const res = await request('rpc/directory_merge_import_row', {
        method: 'POST', body: JSON.stringify({ p_id: targetId, p_source_ref: sourceRef, p_changes: changes }),
      })
      const r = Array.isArray(res) ? res[0] : res
      return { alreadyMerged: false, applied: {}, skipped: [], ...(r || {}) }
    },

    async recordImport({ fileName, fileFingerprint, counts, result }) {
      const rows = await request('directory_imports', {
        method: 'POST',
        body: JSON.stringify({
          file_name: fileName || null, file_fingerprint: fileFingerprint,
          row_counts: counts || {}, result: result || {},
        }),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },

    async listImports(limit = 25) {
      return request('directory_imports?order=created_at.desc&select=*&limit=' + clampLimit(limit))
    },

    async saveCategory(category) {
      return request('directory_categories', { method: 'POST', body: JSON.stringify(category) })
    },
  }
}

export const directoryRepository = createDirectoryRepository()
