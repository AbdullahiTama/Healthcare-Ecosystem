import { haversineMeters } from '../../lib/geo.js'
import { normalizeName, normalizePhone } from '../../lib/facilityDiscovery.js'
import { validateDirectoryRecord, isValidLatLng } from './directoryRecord.js'

// Pure import planning for the business directory: CSV parsing, column mapping,
// per-row validation and duplicate classification. No I/O, no network.
// Execution (batching, retries, progress) lives in directoryImportRunner.js.

export const ROW_STATUS = {
  NEW: 'new',
  POSSIBLE_DUPLICATE: 'possible_duplicate',
  CONFIRMED_DUPLICATE: 'confirmed_duplicate',
  INVALID: 'invalid',
  NEEDS_REVIEW: 'needs_review',
}

export const MAX_IMPORT_ROWS = 5000

// Fields an import file may supply. Verification is deliberately absent: an
// import can never mark a record verified.
export const IMPORT_FIELDS = [
  'name', 'category', 'subcategory', 'business_type', 'address', 'city', 'state', 'lga',
  'latitude', 'longitude', 'phone', 'email', 'website', 'description',
]

const HEADER_ALIASES = {
  name: ['name', 'business name', 'business', 'facility name', 'facility'],
  category: ['category', 'type', 'category slug'],
  subcategory: ['subcategory', 'sub category', 'sub-category'],
  business_type: ['business type', 'business_type'],
  address: ['address', 'street address', 'street'],
  city: ['city', 'town', 'city/town'],
  state: ['state'],
  lga: ['lga', 'local government', 'local government area'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'tel'],
  email: ['email', 'email address', 'e-mail'],
  website: ['website', 'web', 'url', 'site'],
  description: ['description', 'notes', 'about'],
}

export function templateCsv() {
  const header = IMPORT_FIELDS.join(',')
  const example = 'Example Pharmacy,pharmacy,,,12 Allen Avenue,Ikeja,Lagos,Ikeja,6.6018,3.3515,08031234567,info@example.com,example.com,Sample row: delete before importing'
  return header + '\n' + example + '\n'
}

// RFC 4180 parser: quoted fields, doubled quotes, CR/LF/CRLF, newlines inside
// quotes, optional BOM. Returns an array of string arrays; blank lines dropped.
export function parseCsv(input) {
  const s = String(input == null ? '' : input).replace(/^﻿/, '')
  const rows = []
  const rowNumbers = [] // original record number of each kept row (blank lines are skipped but counted)
  let record = 0
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const endField = () => { row.push(field); field = '' }
  const endRow = () => {
    endField()
    record++
    if (row.some((c) => String(c).trim() !== '')) { rows.push(row); rowNumbers.push(record) }
    row = []
  }
  while (i < s.length) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"' && field === '') { inQuotes = true; i++; continue }
    if (c === ',') { endField(); i++; continue }
    if (c === '\r') { if (s[i + 1] === '\n') i++; endRow(); i++; continue }
    if (c === '\n') { endRow(); i++; continue }
    field += c; i++
  }
  if (inQuotes) return { rows: [], rowNumbers: [], error: 'The file has an unclosed quote. Check for a stray " character.' }
  if (field !== '' || row.length) endRow()
  return { rows, rowNumbers, error: null }
}

// Header row -> { field: columnIndex }. Unmatched headers are returned so the
// UI can offer manual mapping.
export function autoMapColumns(headers) {
  const mapping = {}
  const used = new Set()
  const norm = (h) => String(h || '').trim().toLowerCase().replace(/[_]+/g, ' ')
  headers.forEach((h, idx) => {
    const n = norm(h)
    for (const field of Object.keys(HEADER_ALIASES)) {
      if (mapping[field] === undefined && HEADER_ALIASES[field].includes(n)) {
        mapping[field] = idx; used.add(idx); return
      }
    }
  })
  const unmapped = headers.map((h, idx) => ({ header: h, idx })).filter((x) => !used.has(x.idx))
  return { mapping, unmapped }
}

// Cheap, stable, non-cryptographic fingerprint of the file text. Only used to
// make re-importing the same file idempotent (see runner), not for security.
export function fileFingerprint(content) {
  let h = 0x811c9dc5
  const isBytes = typeof content !== 'string'
  const n = content.length
  for (let i = 0; i < n; i++) { h ^= isBytes ? content[i] : content.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + '-' + n.toString(16)
}

function tokenSet(name) {
  return new Set(normalizeName(name).split(' ').filter(Boolean))
}
export function nameSimilarity(a, b) {
  const A = tokenSet(a), B = tokenSet(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

function samePoint(a, b) {
  return isValidLatLng(a.latitude, a.longitude) && isValidLatLng(b.latitude, b.longitude)
}
function metres(a, b) {
  if (!samePoint(a, b)) return null
  return haversineMeters({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude })
}

// Compare one candidate record against one existing/earlier record.
// Returns null, or { level: 'confirmed'|'possible', reasons: [...] }.
export function compareRecords(rec, other) {
  const reasons = []
  const nameEq = !!rec.name_normalized && rec.name_normalized === other.name_normalized
  const phoneEq = !!rec.phone_normalized && rec.phone_normalized === other.phone_normalized
  const sim = nameEq ? 1 : nameSimilarity(rec.name, other.name)
  const dist = metres(rec, other)
  const addrEq = !!rec.address && !!other.address && normalizeName(rec.address) === normalizeName(other.address)

  if (rec.source_ref && other.source_ref && rec.data_source === other.data_source && rec.source_ref === other.source_ref) {
    return { level: 'confirmed', reasons: ['Same source record'] }
  }
  if (nameEq && phoneEq) return { level: 'confirmed', reasons: ['Same name and phone'] }
  if (nameEq && dist !== null && dist <= 50) return { level: 'confirmed', reasons: ['Same name within 50 m'] }

  if (nameEq) reasons.push('Same name')
  if (phoneEq) reasons.push('Same phone')
  if (!nameEq && ((addrEq && sim >= 0.5) || (sim >= 0.75 && dist !== null && dist <= 150))) reasons.push('Similar name at the same place')
  if (!nameEq && sim >= 0.5 && dist !== null && dist <= 30) reasons.push('Similar name within 30 m')
  return reasons.length ? { level: 'possible', reasons } : null
}

function cell(row, mapping, field) {
  const idx = mapping[field]
  return idx === undefined ? '' : String(row[idx] == null ? '' : row[idx]).trim()
}

function resolveCategory(value, categories, parentId) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return { id: null }
  const hit = (categories || []).find((c) =>
    (parentId ? c.parent_id === parentId : !c.parent_id) && (c.slug === v || String(c.name).toLowerCase() === v))
  return hit ? { id: hit.id } : { id: null, unknown: true }
}

/**
 * Plans an import. `existing` is the directory rows the caller found as
 * possible matches (see repository.findCandidates). Rows are compared with
 * those AND with earlier rows of the same file.
 *
 * `rowNumbers[i]` (optional) is the original spreadsheet row of table[i].
 * Returns { rows, counts, fingerprint, error }. Each row:
 *   { row, status, errors: {field:msg}, warnings: [msg], record, candidates: [{ref, level, reasons}] }
 * `row` is the 1-based spreadsheet row number (header = row 1).
 */
export function buildImportPlan(table, { mapping, categories = [], existing = [], fingerprint = '', rowNumbers = null } = {}) {
  if (!table || table.length < 2) return { rows: [], counts: {}, fingerprint, error: 'The file has no data rows.' }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    return { rows: [], counts: {}, fingerprint, error: 'Import at most ' + MAX_IMPORT_ROWS + ' rows per file. Split the file and import in parts.' }
  }
  if (mapping.name === undefined) return { rows: [], counts: {}, fingerprint, error: 'No column is mapped to the business name.' }

  const planned = []
  const seen = [] // { rec, rowNo } of earlier valid rows in this file
  table.slice(1).forEach((cells, i) => {
    // Original spreadsheet row when the reader supplied it (blank rows skipped), else position + 2.
    const rowNo = rowNumbers && rowNumbers[i + 1] ? rowNumbers[i + 1] : i + 2
    const input = {}
    IMPORT_FIELDS.forEach((f) => { input[f] = cell(cells, mapping, f) })

    const cat = resolveCategory(input.category, categories, null)
    const sub = resolveCategory(input.subcategory, categories, cat.id)
    const v = validateDirectoryRecord({
      ...input, category_id: cat.id, subcategory_id: sub.id,
      data_source: 'import', source_ref: fingerprint ? fingerprint + ':' + rowNo : '',
    })
    const errors = { ...v.errors }
    if (cat.unknown) errors.category = 'Unknown category "' + input.category + '".'
    if (sub.unknown) errors.subcategory = 'Unknown subcategory "' + input.subcategory + '" for this category.'

    const record = v.record
    const withKeys = { ...record, name_normalized: normalizeName(record.name), phone_normalized: normalizePhone(record.phone) }

    if (Object.keys(errors).length) {
      planned.push({ row: rowNo, status: ROW_STATUS.INVALID, errors, warnings: [], record, candidates: [] })
      return
    }

    const candidates = []
    let level = null
    const consider = (other, ref) => {
      const m = compareRecords(withKeys, other)
      if (!m) return
      candidates.push({ ref, level: m.level, reasons: m.reasons })
      if (m.level === 'confirmed') level = 'confirmed'
      else if (!level) level = 'possible'
    }
    existing.forEach((e) => consider(e, { id: e.id, name: e.name, verification_status: e.verification_status }))
    seen.forEach((s) => consider(s.rec, { row: s.rowNo, name: s.rec.name }))

    const warnings = []
    if (record.latitude === null) warnings.push('No coordinates: this record cannot appear in radius searches.')
    if (!record.category_id) warnings.push('No category.')
    if (!record.state && !record.city) warnings.push('No state or city.')

    let status = ROW_STATUS.NEW
    if (level === 'confirmed') status = ROW_STATUS.CONFIRMED_DUPLICATE
    else if (level === 'possible') status = ROW_STATUS.POSSIBLE_DUPLICATE
    else if (warnings.length) status = ROW_STATUS.NEEDS_REVIEW

    planned.push({ row: rowNo, status, errors: {}, warnings, record, candidates })
    seen.push({ rec: withKeys, rowNo })
  })

  const counts = planned.reduce((c, r) => { c[r.status] = (c[r.status] || 0) + 1; return c }, {})
  return { rows: planned, counts, fingerprint, error: null }
}

// Decisions a reviewer can make per row. 'merge' is never a default and is only
// available for a row that matches an existing record; it additionally needs a
// confirmed, field-by-field review (see directoryMerge.js) before anything runs.
export const DECISIONS = ['import', 'skip', 'keep_existing', 'merge']

// Existing directory records a row could be merged into (in-file matches cannot be).
export function mergeTargets(planRow) {
  return (planRow && planRow.status !== ROW_STATUS.INVALID ? planRow.candidates : [])
    .filter((c) => c.ref && c.ref.id)
    .map((c) => c.ref)
}

// What happens to each row if the reviewer decides nothing. Duplicates and
// rows needing review are NOT imported by default.
export function defaultDecisions(planRows) {
  const out = {}
  planRows.forEach((r) => {
    out[r.row] = r.status === ROW_STATUS.NEW ? 'import' : 'skip'
  })
  return out
}

// Rows to insert, given decisions. Invalid rows are never insertable, even if
// a caller decides 'import'.
export function selectRowsToImport(planRows, decisions) {
  return planRows.filter((r) => r.status !== ROW_STATUS.INVALID && decisions[r.row] === 'import')
}
