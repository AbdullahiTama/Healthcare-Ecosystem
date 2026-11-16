// Inventory bulk upload (Excel .xlsx or CSV): reading the rows, checking every
// one, and the plan of what will be saved. Pure; the component reads the file
// (readSpreadsheet) and saves the plan (saveInBatches).
//
// Every row submitted ends in exactly one of:
//   ready       saved when the upload is confirmed
//   duplicate   a product with the same name or barcode is already in
//               Inventory, or earlier in this file (skipped, so uploading a
//               corrected file again never adds a product twice)
//   invalid     something in the row must be fixed first (the reason is shown)
//   over_limit  beyond the plan's product limit
//
// Duplicates are matched on the product NAME or BARCODE only. The generic name
// is not used: "Panadol 500mg" and "Emzor Paracetamol 500mg" share the generic
// name Paracetamol but are different products. Matching on it skipped every
// brand of a generic already stocked, which is why large uploads came in short.
//
// Columns are matched by header (any order). A file whose headers are not
// recognised at all is read in the template's order, as before:
//   Product Name · Generic Name · Category · Selling Price (NGN) ·
//   Cost Price (NGN) · Stock Quantity · Reorder Level · Barcode ·
//   List on CareFind (yes/no) · Expiry Date
// The Inventory Excel export uses the same first ten columns, so an export can
// be edited and uploaded again.
//
// Docs: docs/architecture/Bulk-Uploads-and-Debt-Linking.md

import { normalize } from '../../lib/productMatches'
import { parseImportDate, parseImportNumber, readTableByHeader, toCsv } from '../../lib/spreadsheetImport'

export const MAX_INVENTORY_IMPORT_ROWS = 20000
export const MAX_INVENTORY_IMPORT_BYTES = 10 * 1024 * 1024
// A stock quantity left blank: the item is not counted (a service), as before.
export const UNCOUNTED_STOCK = 999

export const INVENTORY_COLUMNS = [
  { key: 'name', header: 'Product Name', required: true, aliases: ['product', 'name', 'item', 'item name', 'brand name', 'product name'] },
  { key: 'generic_name', header: 'Generic Name', aliases: ['generic', 'generic name'] },
  { key: 'category', header: 'Category', aliases: ['category', 'product category'] },
  { key: 'price', header: 'Selling Price (NGN)', aliases: ['selling price', 'selling price ngn', 'price', 'sell price', 'retail price', 'unit price'] },
  { key: 'cost_price', header: 'Cost Price (NGN)', aliases: ['cost price', 'cost price ngn', 'cost', 'unit cost', 'unit cost ngn'] },
  { key: 'stock', header: 'Stock Quantity', aliases: ['stock', 'quantity', 'qty', 'stock qty', 'stock quantity'] },
  { key: 'reorder_level', header: 'Reorder Level', aliases: ['reorder', 'reorder level', 'reorder point'] },
  { key: 'barcode', header: 'Barcode', aliases: ['barcode', 'ean', 'upc', 'gtin'] },
  { key: 'list_on_carefind', header: 'List on CareFind (yes/no)', aliases: ['list on carefind', 'list on carefind yes no', 'carefind'] },
  { key: 'expiry_date', header: 'Expiry Date', aliases: ['expiry', 'expiry date', 'exp date', 'expiration date'] },
]

const TEMPLATE_ROWS = [
  ['Amoxicillin 500mg', 'Amoxicillin', 'Medicines', '1500', '800', '100', '20', '', 'yes', '2027-06-30'],
  ['Paracetamol 500mg', 'Paracetamol', 'Medicines', '800', '400', '200', '30', '', 'yes', '2028-01-31'],
  ['Consultation Fee', 'Medical Consultation', 'Services', '5000', '0', '', '0', '', 'yes', ''],
]

/** The upload template: the headers and three example rows to replace. */
export function buildInventoryTemplateCsv() {
  return toCsv([INVENTORY_COLUMNS.map(c => c.header), ...TEMPLATE_ROWS])
}

/**
 * Coerces a spreadsheet expiry value to an ISO `YYYY-MM-DD` string, or null.
 * Blank → null (the products.expiry_date column is nullable). ISO dates, Excel
 * date cells and serials, and day-first dates (DD/MM/YYYY) are read exactly;
 * anything else goes through the engine's parser (so "5/31/2027" is 31 May).
 * Impossible dates (2027-02-31) → null rather than a guess.
 */
export function normalizeExpiryDate(value) {
  const v = String(value ?? '').trim()
  if (!v) return null
  const exact = parseImportDate(v)
  if (exact) return exact
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) return null
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  const dt = new Date(t)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Spreadsheet rows (from readSpreadsheet) → { rows: [{ rowNumber, cells }], missing, ignored }. Throws a user-facing error. */
export function readInventoryTable(rawRows) {
  return readTableByHeader(rawRows, INVENTORY_COLUMNS, { maxRows: MAX_INVENTORY_IMPORT_ROWS, positional: true })
}

/**
 * One row's cells → { product, problems: [text], warnings: [text] }.
 * `product` is what is saved (without business_id). Numbers accept ₦ and
 * thousands separators ("₦1,500" is 1500, not 1).
 */
export function toImportProduct(cells) {
  const problems = []
  const warnings = []
  const num = (key, label, { whole = false, blank }) => {
    const raw = cells[key]
    const n = parseImportNumber(raw)
    if (n === '') return blank
    if (Number.isNaN(n)) { problems.push(`${label} "${raw}" is not a number.`); return blank }
    if (n < 0) { problems.push(`${label} cannot be negative.`); return blank }
    if (whole && !Number.isInteger(n)) { problems.push(`${label} must be a whole number.`); return blank }
    return n
  }
  const name = String(cells.name || '').trim()
  if (!name) problems.push('Product name is missing.')
  else if (name.length > 300) problems.push('Product name is too long (300 characters at most).')
  const price = num('price', 'Selling price', { blank: 0 })
  const cost = num('cost_price', 'Cost price', { blank: 0 })
  const stock = num('stock', 'Stock quantity', { whole: true, blank: UNCOUNTED_STOCK })
  const reorder = num('reorder_level', 'Reorder level', { whole: true, blank: 5 })
  const expiryRaw = String(cells.expiry_date || '').trim()
  const expiry = normalizeExpiryDate(expiryRaw)
  if (expiryRaw && !expiry) warnings.push(`Expiry date "${expiryRaw}" could not be read; the product is saved without one.`)
  const listed = String(cells.list_on_carefind || '').trim().toLowerCase()
  return {
    product: {
      name,
      generic_name: String(cells.generic_name || '').trim(),
      category: String(cells.category || '').trim() || 'Medicines',
      price,
      cost_price: cost,
      stock,
      reorder_level: reorder,
      barcode: String(cells.barcode || '').trim(),
      list_on_carefind: !['no', 'n', 'false', '0'].includes(listed),
      expiry_date: expiry,
      emoji: '💊',
    },
    problems,
    warnings,
  }
}

/**
 * Checks every row against the catalogue and the rest of the file.
 * ctx: { existing: products already in Inventory, remaining: products the plan
 *        still allows (Infinity when unlimited) }
 * Returns { items, summary }. Each item:
 *   { rowNumber, cells, product, status, reason, warnings }
 */
export function planInventoryImport(rows, { existing = [], remaining = Infinity } = {}) {
  const byName = new Map()
  const byBarcode = new Map()
  for (const p of existing) {
    const n = normalize(p.name)
    if (n && !byName.has(n)) byName.set(n, { label: 'already in Inventory as ' + p.name })
    const b = String(p.barcode || '').trim()
    if (b && !byBarcode.has(b)) byBarcode.set(b, { label: 'barcode ' + b + ' is already used by ' + p.name })
  }
  let allowed = remaining
  const items = rows.map(({ rowNumber, cells }) => {
    const { product, problems, warnings } = toImportProduct(cells)
    const base = { rowNumber, cells, product, warnings }
    if (problems.length) return { ...base, status: 'invalid', reason: problems.join(' ') }
    const n = normalize(product.name)
    const dupe = byName.get(n) || (product.barcode && byBarcode.get(product.barcode))
    if (dupe) return { ...base, status: 'duplicate', reason: 'Duplicate: ' + dupe.label + '.' }
    byName.set(n, { label: 'same name as row ' + rowNumber })
    if (product.barcode) byBarcode.set(product.barcode, { label: 'same barcode as row ' + rowNumber })
    if (allowed <= 0) return { ...base, status: 'over_limit', reason: "Over your plan's product limit." }
    allowed--
    return { ...base, status: 'ready', reason: '' }
  })
  return { items, summary: summarize(items) }
}

function summarize(items) {
  const count = (s) => items.filter(i => i.status === s).length
  return { submitted: items.length, ready: count('ready'), duplicates: count('duplicate'), invalid: count('invalid'), overLimit: count('over_limit') }
}
