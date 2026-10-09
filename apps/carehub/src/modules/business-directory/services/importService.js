// ── BusinessImportService ─────────────────────────────────────────────────────
// Template -> parse -> validate -> classify duplicates -> review -> commit.
//
// Nothing here touches the database until `commitImport`. Everything before it
// is pure and runs in the browser in slices (`await`ing the event loop between
// them) so a 10,000-row file never freezes the tab.

import {
  normalizeName, normalizeAddress, normalizePhone, websiteHost, isValidEmail, isValidPhone,
  isValidWebsite, toNumberOrNull, isValidLatLng, isWithinNigeria, lookupKey,
} from './normalize'
import { canonicalState } from './constants'
import { matchCategory } from './queryParser'
import { createDedupIndex, classifyBatch, buildMergePatch, DUP_STATUS, RESOLUTION } from './deduplication'

export const MAX_FILE_BYTES = 15 * 1024 * 1024
export const MAX_ROWS = 20000
const COMMIT_CHUNK = 500
const MAX_LEN = { name: 200, address: 400, state: 80, lga: 120, city: 120, subcategory: 120, business_type: 120, phone: 60, email: 254, website: 300, contact_person: 160, opening_hours: 300, description: 2000 }

// ── Template ──────────────────────────────────────────────────────────────────
export const TEMPLATE_COLUMNS = [
  { key: 'name', header: 'Business Name', required: true, note: 'Registered or trading name.', aliases: ['name', 'business name', 'facility name', 'company name', 'company'] },
  { key: 'category', header: 'Category', required: true, note: 'Must match a category in the Categories sheet (e.g. Pharmacy).', aliases: ['category', 'business category'] },
  { key: 'subcategory', header: 'Subcategory', required: false, note: 'Optional. New subcategories are created on import after your approval.', aliases: ['subcategory', 'sub category', 'sub-category'] },
  { key: 'business_type', header: 'Business Type', required: false, note: 'Optional free text, e.g. Private, Public, Chain.', aliases: ['business type', 'type', 'ownership'] },
  { key: 'address', header: 'Address', required: true, note: 'Street address.', aliases: ['address', 'street address', 'location address'] },
  { key: 'state', header: 'State', required: true, note: 'e.g. Lagos, Oyo, Federal Capital Territory.', aliases: ['state', 'state of location'] },
  { key: 'lga', header: 'LGA', required: false, note: 'Local Government Area.', aliases: ['lga', 'local government', 'local government area'] },
  { key: 'city', header: 'City/Town', required: false, note: 'City or town.', aliases: ['city', 'town', 'city/town', 'city town'] },
  { key: 'latitude', header: 'Latitude', required: false, note: 'Decimal degrees, e.g. 6.5244. Needed for distance/radius search.', aliases: ['latitude', 'lat'] },
  { key: 'longitude', header: 'Longitude', required: false, note: 'Decimal degrees, e.g. 3.3792. Must be supplied with Latitude.', aliases: ['longitude', 'lng', 'long', 'lon'] },
  { key: 'phone', header: 'Phone Number', required: false, note: 'Nigerian or international format.', aliases: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'contact phone'] },
  { key: 'email', header: 'Email', required: false, note: '', aliases: ['email', 'email address', 'e-mail'] },
  { key: 'website', header: 'Website', required: false, note: 'http(s) address.', aliases: ['website', 'url', 'web', 'web address'] },
  { key: 'contact_person', header: 'Contact Person', required: false, note: '', aliases: ['contact person', 'contact', 'contact name'] },
  { key: 'opening_hours', header: 'Opening Hours', required: false, note: 'Free text, e.g. Mon-Sat 8am-8pm.', aliases: ['opening hours', 'hours', 'working hours'] },
  { key: 'description', header: 'Description', required: false, note: '', aliases: ['description', 'notes', 'about'] },
]

const REQUIRED = TEMPLATE_COLUMNS.filter((c) => c.required)

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Header-only CSV. Contains no sample businesses — nothing to mistake for real data. */
export function buildTemplateCsv() {
  return '﻿' + TEMPLATE_COLUMNS.map((c) => csvEscape(c.header)).join(',') + '\r\n'
}

/** XLSX template: a Businesses sheet (headers only), an Instructions sheet and a Categories sheet. */
export async function buildTemplateXlsx(categories = []) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet('Businesses')
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(16, c.header.length + 6) }))
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  // Header text keeps the " *" marker; the parser strips it.

  const ins = wb.addWorksheet('Instructions')
  ins.columns = [{ header: 'Column', key: 'c', width: 22 }, { header: 'Required', key: 'r', width: 10 }, { header: 'Notes', key: 'n', width: 80 }]
  ins.getRow(1).font = { bold: true }
  TEMPLATE_COLUMNS.forEach((c) => ins.addRow({ c: c.header, r: c.required ? 'Yes' : 'No', n: c.note }))
  ins.addRow({})
  ins.addRow({ c: 'Do not rename or reorder the headers on the Businesses sheet. Delete nothing but data rows.' })
  ins.addRow({ c: 'Only real, verifiable businesses should be imported. Mark test records in the app as DEMO DATA.' })

  const cs = wb.addWorksheet('Categories')
  cs.columns = [{ header: 'Valid categories', key: 'n', width: 40 }]
  cs.getRow(1).font = { bold: true }
  categories.forEach((c) => cs.addRow({ n: c.name }))

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── Parsing ───────────────────────────────────────────────────────────────────
/** RFC 4180 CSV -> array of rows. Handles quotes, embedded newlines, BOM and ; / tab delimiters. */
export function parseCsv(text) {
  let s = String(text ?? '')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const firstLine = s.split(/\r?\n/, 1)[0] || ''
  const stripped = firstLine.replace(/"[^"]*"/g, '')
  const counts = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of stripped) if (ch in counts) counts[ch]++
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"' && field === '') inQuotes = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function cellText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString()
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if ('result' in v) return cellText(v.result)
    if ('text' in v) return cellText(v.text)
    if ('hyperlink' in v) return String(v.hyperlink)
    return ''
  }
  return String(v)
}

/**
 * File/Blob -> array of rows (strings). Rejects oversized files, legacy .xls and
 * anything that is not .csv / .xlsx before reading it.
 */
export async function readSpreadsheet(file) {
  if (!file) throw new Error('Choose a file first.')
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than ' + MAX_FILE_BYTES / 1024 / 1024 + ' MB. Split it into smaller files.')
  const name = String(file.name || '').toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text())
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const ws = wb.getWorksheet('Businesses') || wb.worksheets[0]
    if (!ws) throw new Error('The workbook has no sheets.')
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = []
      const n = Math.max(row.cellCount, TEMPLATE_COLUMNS.length)
      for (let c = 1; c <= n; c++) cells.push(cellText(row.getCell(c).value))
      rows.push(cells)
    })
    return rows
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel choose Save As → Excel Workbook (.xlsx) or CSV.')
  throw new Error('Unsupported file type. Upload the CareHub template as .xlsx or .csv.')
}

/** Map header cells to template keys; report what is missing/unknown. */
export function readTable(rows) {
  const nonEmpty = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (!nonEmpty.length) throw new Error('The file is empty.')
  const header = nonEmpty[0]
  const keyByIndex = {}
  const unknown = []
  header.forEach((h, i) => {
    const k = lookupKey(String(h ?? '').replace(/\*/g, ''))
    if (!k) return
    const col = TEMPLATE_COLUMNS.find((c) => c.aliases.includes(k) || lookupKey(c.header) === k)
    if (col && !Object.values(keyByIndex).includes(col.key)) keyByIndex[i] = col.key
    else unknown.push(String(h).trim())
  })
  const present = new Set(Object.values(keyByIndex))
  const missing = REQUIRED.filter((c) => !present.has(c.key)).map((c) => c.header)
  const data = []
  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = {}
    Object.entries(keyByIndex).forEach(([i, k]) => { cells[k] = String(nonEmpty[r][i] ?? '').trim() })
    data.push(cells)
  }
  if (data.length > MAX_ROWS) throw new Error('The file has ' + data.length + ' rows; the limit is ' + MAX_ROWS + ' per import. Split it into smaller files.')
  return { missing, unknown, rows: data }
}

// ── Validation ────────────────────────────────────────────────────────────────
/**
 * @param cells  {key: string} for one spreadsheet row
 * @param ctx    {categories: [{id,name}], subcategories: [{id,category_id,name}]}
 * @returns {{record, errors, warnings, pendingSubcategory}}
 */
export function validateRow(cells, ctx) {
  const errors = []
  const warnings = []
  const err = (field, message) => errors.push({ field, message })
  const warn = (field, message) => warnings.push({ field, message })
  const get = (k) => String(cells[k] ?? '').trim()

  Object.keys(MAX_LEN).forEach((k) => {
    if (get(k).length > MAX_LEN[k]) err(k, `Too long (max ${MAX_LEN[k]} characters).`)
  })

  const name = get('name')
  if (!name) err('name', 'Business name is required.')
  else if (!normalizeName(name)) err('name', 'Business name has no usable characters.')

  const address = get('address')
  if (!address) err('address', 'Address is required.')

  // State: normalise a known state, keep (and flag) anything else.
  let state = get('state')
  if (!state) err('state', 'State is required.')
  else {
    const canon = canonicalState(state)
    if (canon) state = canon
    else warn('state', `"${state}" is not a recognised Nigerian state.`)
  }

  // Category
  let category = null
  const catText = get('category')
  if (!catText) err('category', 'Category is required.')
  else {
    category = matchCategory(catText, ctx.categories)
    if (!category) err('category', `Unknown category "${catText}". Use a name from the Categories sheet.`)
  }

  // Subcategory (needs a category to attach to)
  let subcategory = null
  let pendingSubcategory = null
  const subText = get('subcategory')
  if (subText && category) {
    const key = lookupKey(subText)
    subcategory = (ctx.subcategories || []).find((s) => s.category_id === category.id && lookupKey(s.name) === key) || null
    if (!subcategory) {
      pendingSubcategory = { category_id: category.id, name: subText }
      warn('subcategory', `Subcategory "${subText}" does not exist under ${category.name}; it will be created if you approve.`)
    }
  }

  // Coordinates
  const lat = toNumberOrNull(cells.latitude)
  const lng = toNumberOrNull(cells.longitude)
  if (Number.isNaN(lat)) err('latitude', 'Latitude is not a number.')
  if (Number.isNaN(lng)) err('longitude', 'Longitude is not a number.')
  let latitude = null
  let longitude = null
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    if ((lat === null) !== (lng === null)) err(lat === null ? 'latitude' : 'longitude', 'Latitude and longitude must both be provided.')
    else if (lat !== null) {
      if (!isValidLatLng(lat, lng)) err('latitude', 'Coordinates are out of range (latitude -90..90, longitude -180..180).')
      else {
        latitude = lat
        longitude = lng
        if (!isWithinNigeria(lat, lng)) warn('latitude', 'Coordinates are outside Nigeria — check the pin (latitude/longitude may be swapped).')
      }
    }
  }

  const phone = get('phone')
  if (phone && !isValidPhone(phone)) err('phone', 'Phone number format is not valid.')
  const email = get('email')
  if (email && !isValidEmail(email)) err('email', 'Email address format is not valid.')
  const website = get('website')
  if (website && !isValidWebsite(website)) err('website', 'Website must be a valid http(s) address.')

  const record = {
    name,
    name_normalized: normalizeName(name),
    category_id: category ? category.id : null,
    subcategory_id: subcategory ? subcategory.id : null,
    business_type: get('business_type') || null,
    address: address || null,
    address_normalized: normalizeAddress(address) || null,
    state: state || null,
    lga: get('lga') || null,
    city: get('city') || null,
    latitude,
    longitude,
    phone: phone || null,
    phone_normalized: normalizePhone(phone) || null,
    email: email || null,
    website: website || null,
    website_host: websiteHost(website) || null,
    contact_person: get('contact_person') || null,
    opening_hours: get('opening_hours') || null,
    description: get('description') || null,
    data_source: 'import',
  }
  return { record, errors, warnings, pendingSubcategory }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
export const ITEM_STATUS = {
  NEW: 'new',
  REVIEW: 'review',
  POSSIBLE: DUP_STATUS.POSSIBLE,
  CONFIRMED: DUP_STATUS.CONFIRMED,
  INVALID: 'invalid',
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Validate + classify. `existing` is the tenant's current directory (rows need
 * the *_normalized columns). Progress: onProgress(phase, done, total).
 */
export async function analyseImport(dataRows, { categories, subcategories, existing, onProgress, shouldCancel, chunkSize = 250 }) {
  const items = []
  for (let i = 0; i < dataRows.length; i++) {
    if (shouldCancel && shouldCancel()) throw new Error('cancelled')
    const v = validateRow(dataRows[i], { categories, subcategories })
    items.push({
      rowNumber: i + 2, // +1 header, +1 to be 1-based like the spreadsheet
      raw: dataRows[i],
      record: v.record,
      errors: v.errors,
      warnings: v.warnings,
      pendingSubcategory: v.pendingSubcategory,
      status: v.errors.length ? ITEM_STATUS.INVALID : ITEM_STATUS.NEW,
      match: null, reasons: [], score: 0, in_file: false, resolution: null,
    })
    if ((i + 1) % chunkSize === 0) { onProgress && onProgress('validating', i + 1, dataRows.length); await yieldToUi() }
  }
  onProgress && onProgress('validating', dataRows.length, dataRows.length)

  const valid = items.filter((it) => it.status !== ITEM_STATUS.INVALID)
  const index = createDedupIndex(existing || [])
  const results = await classifyBatch(valid.map((it) => it.record), index, {
    chunkSize, shouldCancel, onProgress: (d, t) => onProgress && onProgress('checking duplicates', d, t),
  })
  valid.forEach((it, i) => {
    const r = results[i]
    it.match = r.match
    it.reasons = r.reasons
    it.score = r.score
    it.in_file = r.in_file
    if (r.status === DUP_STATUS.CONFIRMED) it.status = ITEM_STATUS.CONFIRMED
    else if (r.status === DUP_STATUS.POSSIBLE) it.status = ITEM_STATUS.POSSIBLE
    else if (it.warnings.length) it.status = ITEM_STATUS.REVIEW
  })
  items.forEach((it) => { it.resolution = defaultResolution(it) })
  return items
}

export function allowedResolutions(item) {
  const fileMatch = item.in_file
  switch (item.status) {
    case ITEM_STATUS.INVALID: return [RESOLUTION.SKIP]
    case ITEM_STATUS.CONFIRMED: return fileMatch ? [RESOLUTION.SKIP, RESOLUTION.IMPORT_NEW] : [RESOLUTION.KEEP_EXISTING, RESOLUTION.MERGE, RESOLUTION.SKIP]
    case ITEM_STATUS.POSSIBLE: return fileMatch ? [RESOLUTION.IMPORT_NEW, RESOLUTION.SKIP] : [RESOLUTION.KEEP_EXISTING, RESOLUTION.IMPORT_NEW, RESOLUTION.MERGE, RESOLUTION.SKIP]
    default: return [RESOLUTION.IMPORT_NEW, RESOLUTION.SKIP]
  }
}

export function defaultResolution(item) {
  switch (item.status) {
    case ITEM_STATUS.INVALID: return RESOLUTION.SKIP
    case ITEM_STATUS.CONFIRMED: return item.in_file ? RESOLUTION.SKIP : RESOLUTION.KEEP_EXISTING
    case ITEM_STATUS.POSSIBLE: return null // a human must decide
    default: return RESOLUTION.IMPORT_NEW
  }
}

export function summarise(items) {
  const s = { total: items.length, new: 0, possible: 0, confirmed: 0, invalid: 0, review: 0, withoutCoordinates: 0, unresolved: 0 }
  items.forEach((it) => {
    if (it.status === ITEM_STATUS.NEW) s.new++
    else if (it.status === ITEM_STATUS.POSSIBLE) s.possible++
    else if (it.status === ITEM_STATUS.CONFIRMED) s.confirmed++
    else if (it.status === ITEM_STATUS.INVALID) s.invalid++
    else if (it.status === ITEM_STATUS.REVIEW) s.review++
    if (it.status !== ITEM_STATUS.INVALID && it.record.latitude == null) s.withoutCoordinates++
    if (it.resolution === null) s.unresolved++
  })
  return s
}

/** What committing the current decisions would do. */
export function planCommit(items) {
  const inserts = []
  const merges = []
  let skipped = 0
  let keptExisting = 0
  let unresolved = 0
  items.forEach((it) => {
    switch (it.resolution) {
      case RESOLUTION.IMPORT_NEW: inserts.push(it); break
      case RESOLUTION.MERGE: {
        const patch = it.match && !it.in_file ? buildMergePatch(it.match, it.record) : null
        if (patch) merges.push({ id: it.match.id, patch, item: it })
        else keptExisting++
        break
      }
      case RESOLUTION.KEEP_EXISTING: keptExisting++; break
      case RESOLUTION.SKIP: skipped++; break
      default: unresolved++
    }
  })
  return { inserts, merges, skipped, keptExisting, unresolved }
}

/**
 * Write the reviewed import. Chunked; stops at the first failed chunk and
 * reports how far it got. Re-running the same file is safe — rows that did
 * land are then classified as confirmed duplicates and skipped.
 */
export async function commitImport({ items, repo, businessId, scope, createdBy, fileName, onProgress, shouldCancel }) {
  // `businessId` owns the batch record (always a real company); `scope` says where
  // the rows land — the company's own directory (default) or the PLATFORM registry.
  const owner = scope ?? businessId
  const plan = planCommit(items)
  if (plan.unresolved > 0) throw new Error(plan.unresolved + ' possible duplicate(s) still need a decision.')

  const counts = summarise(items)
  const batch = await repo.createBatch(businessId, {
    file_name: fileName || null, total_rows: counts.total, new_count: counts.new,
    possible_duplicate_count: counts.possible, confirmed_duplicate_count: counts.confirmed,
    invalid_count: counts.invalid, review_count: counts.review, created_by: createdBy || null,
  })

  let imported = 0
  let merged = 0
  let failure = null
  try {
    // Subcategories first (deduplicated), so rows can reference them.
    const subIds = new Map()
    const cats = [...new Map(plan.inserts.filter((it) => it.pendingSubcategory).map((it) => [it.pendingSubcategory.category_id + '|' + lookupKey(it.pendingSubcategory.name), it.pendingSubcategory])).values()]
    for (const p of cats) {
      const row = await repo.ensureSubcategory(owner, p.category_id, p.name)
      subIds.set(p.category_id + '|' + lookupKey(p.name), row.id)
    }

    const total = plan.inserts.length + plan.merges.length
    for (let i = 0; i < plan.inserts.length; i += COMMIT_CHUNK) {
      if (shouldCancel && shouldCancel()) throw new Error('cancelled')
      const slice = plan.inserts.slice(i, i + COMMIT_CHUNK)
      await repo.insertMany(owner, batch.id, slice.map((it) => ({
        ...it.record,
        subcategory_id: it.record.subcategory_id || (it.pendingSubcategory ? subIds.get(it.pendingSubcategory.category_id + '|' + lookupKey(it.pendingSubcategory.name)) || null : null),
        created_by: createdBy || null,
      })))
      imported += slice.length
      onProgress && onProgress('importing', imported, total)
      await yieldToUi()
    }
    for (const m of plan.merges) {
      if (shouldCancel && shouldCancel()) throw new Error('cancelled')
      await repo.update(m.id, owner, m.patch)
      merged++
      onProgress && onProgress('importing', imported + merged, total)
    }
    const bad = items.filter((it) => it.status === ITEM_STATUS.INVALID)
    for (let i = 0; i < bad.length; i += COMMIT_CHUNK) {
      await repo.addImportErrors(businessId, batch.id, bad.slice(i, i + COMMIT_CHUNK).flatMap((it) =>
        it.errors.map((e) => ({ row_number: it.rowNumber, field: e.field, message: e.message, raw: it.raw }))))
    }
  } catch (e) {
    failure = e
  }

  const status = failure ? (failure.message === 'cancelled' ? 'cancelled' : 'failed') : 'completed'
  await repo.finishBatch(batch.id, businessId, { status, imported_count: imported + merged, skipped_count: plan.skipped + plan.keptExisting })
  if (failure && status === 'failed') {
    const err = new Error(`Import stopped after ${imported + merged} record(s): ${failure.message}`)
    err.partial = { imported, merged, batchId: batch.id }
    throw err
  }
  return { batchId: batch.id, imported, merged, skipped: plan.skipped, keptExisting: plan.keptExisting, cancelled: status === 'cancelled' }
}
