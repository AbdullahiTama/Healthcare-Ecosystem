// ── Product library rules ────────────────────────────────────────────────────
// Pure helpers for the shared CareHub product library (Product-Catalogue-Design.md
// §3.1, phase 4): how an item is named and labelled, the admin's item form, and
// reading an official list (NAFDAC) whatever its columns. No React, no network.
import { RX_STATUSES, rxStatus } from '../master-catalog/catalogueRules'
import { refusalMessage } from '../../lib/dbErrors'

export { RX_STATUSES, rxStatus }

export const LIBRARY_STATUS = {
  pending: { label: 'Waiting for review', pill: 'amber' },
  active: { label: 'Approved', pill: 'green' },
  retired: { label: 'Retired', pill: 'gray' },
}

export const LIBRARY_SOURCE = {
  seeded: 'From business catalogues',
  nafdac_import: 'Official list',
  suggested: 'Suggested by a business',
  admin: 'Added by CareHub',
}

const text = (v) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' '))

// "Amoxil 500mg" — the name, and the strength when it is not already part of it.
export function libraryLabel(item) {
  if (!item) return ''
  const name = text(item.brand_name)
  const strength = text(item.strength)
  return strength && !name.toLowerCase().includes(strength.toLowerCase()) ? `${name} ${strength}` : name
}

// The facts under a name: "Amoxicillin · Capsule · 10 x 10 · NAFDAC A4-1234".
export function libraryFacts(item) {
  if (!item) return ''
  return [item.generic_name, item.dose_form, item.pack_size, item.manufacturer, item.nafdac_no && `NAFDAC ${item.nafdac_no}`]
    .map(text).filter(Boolean).join(' · ')
}

// ── The admin's item form ─────────────────────────────────────────────────────
export function formFromLibrary(item) {
  return {
    brand_name: item?.brand_name || '',
    generic_name: item?.generic_name || '',
    strength: item?.strength || '',
    dose_form: item?.dose_form || '',
    pack_size: item?.pack_size || '',
    manufacturer: item?.manufacturer || '',
    nafdac_no: item?.nafdac_no || '',
    barcodes: (item?.barcodes || (item?.barcode ? [item.barcode] : [])).join(', '),
    category_code: item?.category_code || '',
    rx_status: item?.rx_status || '',
    description: item?.description || '',
  }
}

const BARCODE = /^[0-9A-Za-z-]{4,32}$/

// Returns { errors } or { payload } for admin_save_catalog_item.
export function validateLibraryForm(form, { categories = [] } = {}) {
  const errors = {}
  const name = text(form.brand_name)
  if (!name) errors.brand_name = 'Enter the product name.'
  else if (name.length > 200) errors.brand_name = 'Keep the name under 200 characters.'
  const codes = String(form.barcodes || '').split(/[,;\s]+/).map((b) => b.trim()).filter(Boolean)
  if (codes.some((b) => !BARCODE.test(b))) errors.barcodes = 'Barcodes are 4 to 32 letters or digits, separated by commas.'
  if (form.category_code && categories.length && !categories.some((c) => c.code === form.category_code)) errors.category_code = 'Choose a category from the list.'
  if (form.rx_status && !rxStatus(form.rx_status)) errors.rx_status = 'Choose a prescription status from the list.'
  if (text(form.nafdac_no).length > 40) errors.nafdac_no = 'A NAFDAC number is at most 40 characters.'
  if (Object.keys(errors).length) return { errors }
  return {
    payload: {
      brand_name: name,
      generic_name: text(form.generic_name) || null,
      strength: text(form.strength) || null,
      dose_form: text(form.dose_form) || null,
      pack_size: text(form.pack_size) || null,
      manufacturer: text(form.manufacturer) || null,
      nafdac_no: text(form.nafdac_no).toUpperCase() || null,
      barcodes: [...new Set(codes)],
      category_code: form.category_code || null,
      rx_status: form.rx_status || null,
      description: text(form.description) || null,
    },
  }
}

// ── Importing an official list ────────────────────────────────────────────────
// The fields a row can fill, and the column headings that usually hold them.
export const IMPORT_FIELDS = [
  { key: 'brand_name', label: 'Product name', required: true, aliases: ['product name', 'brand name', 'brand', 'name', 'product', 'trade name', 'name of product', 'drug name'] },
  { key: 'generic_name', label: 'Generic name', aliases: ['generic name', 'generic', 'inn', 'active ingredient', 'active ingredients', 'composition'] },
  { key: 'strength', label: 'Strength', aliases: ['strength', 'dosage strength', 'dose'] },
  { key: 'dose_form', label: 'Form', aliases: ['dosage form', 'form', 'dose form', 'presentation'] },
  { key: 'pack_size', label: 'Pack size', aliases: ['pack size', 'pack', 'packaging', 'pack presentation'] },
  { key: 'manufacturer', label: 'Manufacturer', aliases: ['manufacturer', 'applicant', 'company', 'marketing authorisation holder', 'holder', 'maker'] },
  { key: 'nafdac_no', label: 'NAFDAC number', aliases: ['nafdac no', 'nafdac number', 'nafdac reg no', 'registration number', 'reg no', 'nafdac', 'reg number'] },
  { key: 'barcodes', label: 'Barcode', aliases: ['barcode', 'barcodes', 'gtin', 'ean', 'upc'] },
  { key: 'category', label: 'Category', aliases: ['category', 'class', 'therapeutic class', 'group'] },
  { key: 'rx_status', label: 'Prescription class', aliases: ['prescription class', 'classification', 'legal status', 'pom/otc', 'otc/pom', 'status', 'schedule'] },
]

const headingKey = (h) => String(h ?? '').toLowerCase().replace(/[*_.:#]/g, ' ').replace(/\s+/g, ' ').trim()

// Column index → field key, guessed from the headings. Each field is used once.
export function guessMapping(headers = []) {
  const mapping = {}
  const used = new Set()
  headers.forEach((h, i) => {
    const k = headingKey(h)
    if (!k) return
    const field = IMPORT_FIELDS.find((f) => !used.has(f.key) && (f.aliases.includes(k) || headingKey(f.label) === k))
    if (field) { mapping[i] = field.key; used.add(field.key) }
  })
  return mapping
}

export const MAX_IMPORT_ROWS = 50000
export const IMPORT_BATCH = 500

// The file's rows (first row is the heading) → rows for admin_import_catalog_items, using `mapping`
// (column index → field key). Empty lines are dropped. `missingName` counts rows without a product name.
export function rowsFromSheet(sheet, mapping) {
  const body = (sheet || []).slice(1).filter((r) => r.some((c) => text(c) !== ''))
  if (body.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${body.length.toLocaleString()} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString()} per import. Split it into smaller files.`)
  let missingName = 0
  const rows = body.map((cells) => {
    const row = {}
    for (const [i, key] of Object.entries(mapping)) {
      if (!key) continue
      const v = text(cells[i])
      if (v) row[key] = v
    }
    if (row.barcodes) row.barcodes = row.barcodes.split(/[,;\s]+/).filter(Boolean)
    if (!row.brand_name) missingName++
    return row
  })
  return { rows, missingName }
}

export function chunk(list, size = IMPORT_BATCH) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// Adds one batch's result to the running total. A batch's error rows are numbered within the batch; `offset` makes
// them file row numbers (heading = row 1).
export function addImportResult(total, batch, offset) {
  return {
    inserted: total.inserted + (batch?.inserted || 0),
    updated: total.updated + (batch?.updated || 0),
    skipped: total.skipped + (batch?.skipped || 0),
    errors: [...total.errors, ...(batch?.errors || []).map((e) => ({ row: offset + e.row + 2, reason: e.reason }))].slice(0, 200),
  }
}

export const emptyImportResult = () => ({ inserted: 0, updated: 0, skipped: 0, errors: [] })

export const libraryError = (e, fallback) => refusalMessage(e, fallback)
