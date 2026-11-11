// Bulk upload of purchase records from Excel (.xlsx) or CSV, and the template.
// Pure: reading the file, checking every row and grouping rows into purchases
// happen here; nothing touches the database. Each planned purchase is then
// recorded by recordPurchase.js, exactly like one typed into the form.
//
// One spreadsheet row is one purchase LINE (a product on a supplier invoice).
// Rows are grouped into purchases by "Purchase Ref" when it is filled in,
// otherwise by supplier + supply date. Columns are matched by their header
// (any order; common alternative names accepted), so the Excel export of
// purchases can be edited and uploaded again.
//
// Docs: docs/architecture/Purchases-Import-Export.md

import { lookupKey } from '../business-directory/services/normalize'
import { blankItem, findProductForEntry, itemProblems, findProductByBarcode } from './lineItems'
import { purchaseFigures } from './recordPurchase'
import { PRODUCT_CATS } from '../../config/constants'

export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const IMPORT_SHEET = 'Purchases'

// key: the field on the purchase form; level: 'line' (per row) or 'purchase'
// (shared by every row of one purchase; the first filled value is used and a
// different value on another row of the same purchase is an error).
export const IMPORT_COLUMNS = [
  { key: 'ref', header: 'Purchase Ref', level: 'purchase', required: false, note: 'Optional. Rows with the same ref are one purchase (e.g. the supplier invoice number). Without it, rows with the same supplier and supply date are one purchase.', aliases: ['purchase ref', 'ref', 'reference', 'invoice', 'invoice no', 'invoice number', 'purchase id'] },
  { key: 'supplier', header: 'Supplier', level: 'purchase', required: true, note: 'Supplier name.', aliases: ['supplier', 'supplier name', 'vendor', 'vendor name'] },
  { key: 'supplyDate', header: 'Supply Date', level: 'purchase', required: true, note: 'YYYY-MM-DD or DD/MM/YYYY. Not in the future.', aliases: ['supply date', 'date', 'purchase date', 'date supplied', 'delivery date'] },
  { key: 'name', header: 'Product Name', level: 'line', required: true, note: 'Matched to your Inventory by exact name or barcode; a new name creates a new product.', aliases: ['product name', 'product', 'item', 'item name', 'description'] },
  { key: 'qty', header: 'Quantity', level: 'line', required: true, note: 'Whole number above 0.', aliases: ['quantity', 'qty', 'units'] },
  { key: 'cost', header: 'Unit Cost (NGN)', level: 'line', required: true, note: 'Cost of one unit, above 0.', aliases: ['unit cost ngn', 'unit cost', 'cost', 'cost price', 'cost price ngn', 'unit price'] },
  { key: 'sell', header: 'Selling Price (NGN)', level: 'line', required: false, note: 'Optional. Sets the price of a new product; changes an existing product\'s price only if your role may edit prices.', aliases: ['selling price ngn', 'selling price', 'sell price', 'price', 'retail price'] },
  { key: 'batch', header: 'Batch No.', level: 'line', required: false, note: 'Needed for products tracked by batch.', aliases: ['batch no', 'batch', 'batch number', 'lot', 'lot number'] },
  { key: 'expiry', header: 'Expiry Date', level: 'line', required: false, note: 'YYYY-MM-DD or DD/MM/YYYY. Needed for products tracked by expiry.', aliases: ['expiry date', 'expiry', 'exp date', 'expiration date'] },
  { key: 'barcode', header: 'Barcode', level: 'line', required: false, note: 'Optional. Saved onto a product that has none.', aliases: ['barcode', 'ean', 'upc', 'gtin'] },
  { key: 'cat', header: 'Category', level: 'line', required: false, note: 'For new products: ' + PRODUCT_CATS.join(', ') + '. Default Medicines.', aliases: ['category', 'product category'] },
  { key: 'amountPaid', header: 'Amount Paid (NGN)', level: 'purchase', required: false, note: 'What was paid for the whole purchase (blank = nothing paid). Any balance is added to Debts.', aliases: ['amount paid ngn', 'amount paid', 'paid'] },
  { key: 'dueDate', header: 'Due Date', level: 'purchase', required: false, note: 'When the balance is due.', aliases: ['due date', 'payment due', 'due'] },
  { key: 'notes', header: 'Notes', level: 'purchase', required: false, note: 'Optional.', aliases: ['notes', 'note', 'remarks', 'comment'] },
]
const COLUMN_BY_ALIAS = new Map(IMPORT_COLUMNS.flatMap(c => [lookupKey(c.header), ...c.aliases.map(lookupKey)].map(a => [a, c])))
const REQUIRED = IMPORT_COLUMNS.filter(c => c.required)
const PURCHASE_FIELDS = IMPORT_COLUMNS.filter(c => c.level === 'purchase' && c.key !== 'ref' && c.key !== 'supplier' && c.key !== 'supplyDate')
const LABEL = Object.fromEntries(IMPORT_COLUMNS.map(c => [c.key, c.header]))

const SAMPLE_ROWS = [
  ['INV-1042', 'Emzor Distributors', '2026-11-03', 'Paracetamol 500mg', '200', '45', '80', 'B2311', '2028-06-30', '', 'Medicines', '5000', '2026-11-30', ''],
  ['INV-1042', 'Emzor Distributors', '2026-11-03', 'Amoxicillin 500mg', '50', '220', '350', 'AX77', '2027-12-31', '', 'Medicines', '', '', ''],
]

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** CSV template: the headers and two example rows (one purchase of two lines) to replace. */
export function buildTemplateCsv() {
  return '﻿' + [IMPORT_COLUMNS.map(c => c.header), ...SAMPLE_ROWS].map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

/** Excel template: a Purchases sheet (headers + example rows) and an Instructions sheet. */
export async function buildTemplateXlsx() {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet(IMPORT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = IMPORT_COLUMNS.map(c => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(14, c.header.length + 6), style: { numFmt: '@' } }))
  ws.getRow(1).font = { bold: true }
  SAMPLE_ROWS.forEach(r => ws.addRow(r))
  const ins = wb.addWorksheet('Instructions')
  ins.columns = [{ header: 'Column', key: 'c', width: 22 }, { header: 'Required', key: 'r', width: 10 }, { header: 'Notes', key: 'n', width: 90 }]
  ins.getRow(1).font = { bold: true }
  IMPORT_COLUMNS.forEach(c => ins.addRow({ c: c.header, r: c.required ? 'Yes' : 'No', n: c.note }))
  ins.addRow({})
  ins.addRow({ c: 'One row per product line. Replace the two example rows with your own before uploading.' })
  ins.addRow({ c: 'Each purchase is recorded like one typed into Record Purchase: stock is added to Inventory and any balance goes to Debts.' })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── Values ────────────────────────────────────────────────────────────────────
function realDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A spreadsheet date as 'YYYY-MM-DD', '' when blank, or null when it cannot be
 * read for certain. Accepts ISO dates, an Excel date cell (read as an ISO
 * timestamp at UTC midnight), an Excel serial number, and day-first dates
 * (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY: the Nigerian convention). Month-first
 * dates are not guessed: 05/11/2026 is 5 November.
 */
export function parseImportDate(value) {
  const v = String(value ?? '').trim()
  if (!v) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T00:00:00(?:\.000)?Z?)?$/.exec(v)
  if (m) return realDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v)
  if (m) return realDate(+m[3], +m[2], +m[1])
  if (/^\d{5}$/.test(v)) {
    const n = Number(v)
    if (n < 20000 || n > 80000) return null
    const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    return dt.toISOString().slice(0, 10)
  }
  return null
}

/** "₦1,250.50" → 1250.5; '' when blank; NaN when not a number. */
export function parseImportNumber(value) {
  const v = String(value ?? '').replace(/[₦,\s]/g, '').replace(/^NGN/i, '')
  if (v === '') return ''
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
}

// ── Table ─────────────────────────────────────────────────────────────────────
/**
 * Rows of cells (the first non-empty row is the header) → { rows, missing, ignored }.
 * rows: [{ rowNumber, cells: { key: text } }]; rowNumber is the spreadsheet row.
 * Throws a user-facing error for an empty or oversized file.
 */
export function readPurchaseTable(rawRows) {
  const indexed = (rawRows || []).map((r, i) => ({ r, n: i + 1 })).filter(x => (x.r || []).some(c => String(c ?? '').trim() !== ''))
  if (!indexed.length) throw new Error('The file is empty.')
  const header = indexed[0].r
  const keyByIndex = {}
  const ignored = []
  header.forEach((h, i) => {
    const col = COLUMN_BY_ALIAS.get(lookupKey(String(h ?? '').replace(/\*/g, '')))
    if (col && !Object.values(keyByIndex).includes(col.key)) keyByIndex[i] = col.key
    else if (String(h ?? '').trim()) ignored.push(String(h).trim())
  })
  const present = new Set(Object.values(keyByIndex))
  const missing = REQUIRED.filter(c => !present.has(c.key)).map(c => c.header)
  const rows = indexed.slice(1).map(({ r, n }) => {
    const cells = {}
    Object.entries(keyByIndex).forEach(([i, k]) => { cells[k] = String(r[i] ?? '').trim() })
    return { rowNumber: n, cells }
  })
  if (!rows.length) throw new Error('The file has headers but no purchase rows.')
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${rows.length.toLocaleString()} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString()} per upload. Split it into smaller files.`)
  return { rows, missing, ignored }
}

const supplierKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const money = (n) => Math.round((Number(n) || 0) * 100) / 100

// The key two purchases are compared by to spot one already recorded.
export const duplicateKey = (supplier, supplyDate, total) => supplierKey(supplier) + '|' + String(supplyDate || '').slice(0, 10) + '|' + money(total).toFixed(2)

/**
 * Checks every row and groups them into purchases.
 *
 * ctx: { inventory, today ('YYYY-MM-DD'), restricted (an expired plan cannot
 *        create products), canReprice (the role may change selling prices: a
 *        different price on an existing product is then applied, and said so),
 *        existingKeys (Set of duplicateKey for purchases already recorded in
 *        the file's date range) }
 *
 * Returns { purchases, summary }. Each purchase:
 *   { key, ref, rowNumbers, form, total, errors: [text], warnings: [text],
 *     duplicate (looks already recorded), newProducts: [name] }
 * A purchase with errors cannot be recorded; `form` is what recordPurchase takes.
 */
export function buildImportPlan(rows, { inventory = [], today, restricted = false, canReprice = false, existingKeys = new Set() } = {}) {
  const groups = new Map()
  const order = []
  for (const { rowNumber, cells } of rows) {
    const rowErrors = []
    const at = (msg) => rowErrors.push(`Row ${rowNumber}: ${msg}`)
    const supplier = String(cells.supplier || '').trim()
    if (!supplier) at('Supplier is missing.')
    else if (supplier.length > 200) at('Supplier name is too long.')
    const supplyDate = parseImportDate(cells.supplyDate)
    if (supplyDate === '') at('Supply date is missing.')
    else if (supplyDate === null) at(`Supply date "${cells.supplyDate}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`)
    else if (today && supplyDate > today) at(`Supply date ${supplyDate} is in the future.`)

    const ref = String(cells.ref || '').trim()
    const key = ref ? 'ref:' + ref.toLowerCase() : 'sd:' + supplierKey(supplier) + '|' + (supplyDate || '')
    if (!groups.has(key)) {
      groups.set(key, { key, ref, supplier, supplyDate: supplyDate || '', rowNumbers: [], lines: [], purchaseValues: {}, errors: [], warnings: [] })
      order.push(key)
    }
    const g = groups.get(key)
    g.rowNumbers.push(rowNumber)
    if (ref && g.rowNumbers.length > 1) {
      if (supplier && g.supplier && supplierKey(supplier) !== supplierKey(g.supplier)) at(`Purchase Ref ${ref} has a different supplier on another row (${g.supplier}).`)
      if (supplyDate && g.supplyDate && supplyDate !== g.supplyDate) at(`Purchase Ref ${ref} has a different supply date on another row (${g.supplyDate}).`)
    }
    if (!g.supplier && supplier) g.supplier = supplier
    if (!g.supplyDate && supplyDate) g.supplyDate = supplyDate

    // Purchase-level values: the first filled one counts; a different one is a conflict.
    for (const { key: k } of PURCHASE_FIELDS) {
      const raw = String(cells[k] || '').trim()
      if (!raw) continue
      let val = raw
      if (k === 'amountPaid') {
        const n = parseImportNumber(raw)
        if (Number.isNaN(n) || n < 0) { at(`Amount paid "${raw}" is not a valid amount.`); continue }
        val = String(n)
      } else if (k === 'dueDate') {
        const d = parseImportDate(raw)
        if (!d) { at(`Due date "${raw}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`); continue }
        val = d
      } else if (k === 'notes' && raw.length > 1000) { at('Notes are too long (1,000 characters at most).'); continue }
      if (g.purchaseValues[k] === undefined) g.purchaseValues[k] = val
      else if (g.purchaseValues[k] !== val) at(`${LABEL[k]} differs from another row of the same purchase (${g.purchaseValues[k]} and ${val}). Fill it in once, or the same on every row.`)
    }

    // The line, as the form keeps it (strings), then the form's own line rules.
    const qty = parseImportNumber(cells.qty)
    const cost = parseImportNumber(cells.cost)
    const sell = parseImportNumber(cells.sell)
    const expiry = parseImportDate(cells.expiry)
    if (Number.isNaN(qty)) at(`Quantity "${cells.qty}" is not a number.`)
    if (Number.isNaN(cost)) at(`Unit cost "${cells.cost}" is not a number.`)
    if (Number.isNaN(sell) || (sell !== '' && sell < 0)) at(`Selling price "${cells.sell}" is not a valid amount.`)
    if (expiry === null) at(`Expiry date "${cells.expiry}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`)
    const name = String(cells.name || '').trim()
    const product = name ? findProductForEntry(inventory, name) : null
    const cat = String(cells.cat || '').trim()
    const line = {
      ...blankItem(),
      productId: product ? product.id : null,
      name: product ? product.name : name,
      qty: qty === '' || Number.isNaN(qty) ? '' : String(qty),
      cost: cost === '' || Number.isNaN(cost) ? '' : String(cost),
      sell: sell === '' || Number.isNaN(sell) ? '' : String(sell),
      batch: String(cells.batch || '').trim(),
      expiry: expiry || '',
      barcode: String(cells.barcode || '').trim(),
      cat: (product && (product.category || product.cat)) || PRODUCT_CATS.find(c => c.toLowerCase() === cat.toLowerCase()) || (cat ? 'Other' : 'Medicines'),
    }
    if (!product && cat && !PRODUCT_CATS.some(c => c.toLowerCase() === cat.toLowerCase())) g.warnings.push(`Row ${rowNumber}: category "${cat}" is not one of ${PRODUCT_CATS.join(', ')}; Other is used.`)
    if (!name) at('Product name is missing.')
    else {
      const problems = itemProblems(line, product, { barcodeOwner: findProductByBarcode(inventory, line.barcode) })
      // Unreadable numbers were already reported above.
      if (Number.isNaN(qty)) delete problems.qty
      if (Number.isNaN(cost)) delete problems.cost
      for (const [field, msg] of Object.entries(problems)) at(`${LABEL[field] || field}: ${msg}.`)
    }
    // Recording applies a different selling price to an existing product (as the form does), so say so before.
    if (product && canReprice && Number(line.sell) > 0 && Number(line.sell) !== Number(product.price)) g.warnings.push(`Row ${rowNumber}: the selling price of ${product.name} will change from ${money(product.price)} to ${money(line.sell)}.`)
    if (line.expiry && today && line.expiry < today) g.warnings.push(`Row ${rowNumber}: ${name || 'this product'} expired on ${line.expiry}.`)
    g.lines.push({ line, isNew: !product && !!name })
    g.errors.push(...rowErrors)
  }

  const purchases = order.map((k) => {
    const g = groups.get(k)
    const form = {
      supplier: g.supplier,
      supplyDate: g.supplyDate,
      dueDate: g.purchaseValues.dueDate || '',
      amountPaid: g.purchaseValues.amountPaid || '',
      notes: g.purchaseValues.notes || (g.ref ? 'Ref ' + g.ref : ''),
      items: g.lines.map(x => x.line),
    }
    const { total, paid } = purchaseFigures(form)
    const errors = [...g.errors]
    const warnings = [...g.warnings]
    if (paid > total + 0.005 && total > 0) errors.push(`Amount paid (${money(paid)}) is more than the purchase total (${money(total)}).`)
    if (form.dueDate && form.supplyDate && form.dueDate < form.supplyDate) warnings.push(`Due date ${form.dueDate} is before the supply date.`)
    // New product names, once each (two lines of one new product create it once).
    const newProducts = [...new Map(g.lines.filter(x => x.isNew).map(x => [x.line.name.toLowerCase(), x.line.name])).values()]
    if (restricted && newProducts.length) errors.push('Your plan has expired, so new products cannot be added: ' + newProducts.join(', ') + '. Use names of products you already stock, or renew.')
    const duplicate = !errors.length && existingKeys.has(duplicateKey(form.supplier, form.supplyDate, total))
    if (duplicate) warnings.push('A purchase from this supplier on this date with the same total is already recorded.')
    return { key: g.key, ref: g.ref, rowNumbers: g.rowNumbers, form, total: money(total), paid: money(paid), errors, warnings, duplicate, newProducts }
  })

  const ready = purchases.filter(p => !p.errors.length)
  return {
    purchases,
    summary: {
      rows: rows.length,
      purchases: purchases.length,
      ready: ready.length,
      withErrors: purchases.length - ready.length,
      duplicates: ready.filter(p => p.duplicate).length,
      total: money(ready.reduce((s, p) => s + p.total, 0)),
      newProducts: new Set(ready.flatMap(p => p.newProducts.map(n => n.toLowerCase()))).size,
    },
  }
}

/** The supply-date range the plan covers, for loading purchases to compare against. */
export function planDateRange(purchases) {
  const dates = purchases.map(p => p.form.supplyDate).filter(Boolean).sort()
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
}

/**
 * Records the chosen purchases one after another (each its own transaction set,
 * like the form). `record(form, inventory)` records one and returns its result;
 * products created by one purchase are passed on to the next, so two purchases
 * of a new product create it once. Never throws: returns
 * { recorded: [{ purchase, result }], failed: [{ purchase, message }] }.
 */
export async function commitImportPlan(purchases, { inventory = [], record, mergeProducts, onProgress, shouldCancel } = {}) {
  const recorded = []
  const failed = []
  let known = inventory
  for (let i = 0; i < purchases.length; i++) {
    if (shouldCancel?.()) break
    const p = purchases[i]
    try {
      // Re-link lines to products created by an earlier purchase in this upload.
      const form = { ...p.form, items: p.form.items.map(l => (l.productId ? l : (() => { const m = findProductForEntry(known, l.name); return m ? { ...l, productId: m.id, name: m.name } : l })())) }
      const result = await record(form, known)
      if (result?.changedRows?.length && mergeProducts) known = mergeProducts(known, result.changedRows)
      recorded.push({ purchase: p, result })
    } catch (e) {
      failed.push({ purchase: p, message: String(e?.message || e).replace(/^Supabase error \(\d{3}\):\s*/, '') })
    }
    onProgress?.(i + 1, purchases.length)
  }
  return { recorded, failed }
}
