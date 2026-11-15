// Supplier list: contact details per supplier (table `suppliers`, carehub_20270119_supplier_directory), its Excel/CSV
// import and its place in the Supplier summary. Pure: no I/O.
//
// A supplier record attaches to that supplier's purchases and supply records by its key, lower(btrim(name)), the key
// purchases always used (supplierKey). Nothing is re-keyed: a supplier with purchases but no record keeps its account,
// and a record without purchases shows with nothing supplied yet.
// Docs: docs/architecture/Supplier-Directory.md.
import { supplierKey, matchSupplier } from './suppliers'
import { lookupKey, isValidEmail, isValidPhone } from '../business-directory/services/normalize'

export const MAX_SUPPLIER_IMPORT_ROWS = 2000
export const MAX_SUPPLIER_IMPORT_BYTES = 5 * 1024 * 1024
export const SUPPLIER_SHEET = 'Suppliers'

// Field limits mirror the table's CHECK constraints, so a row the preview accepts is never refused on save.
export const SUPPLIER_FIELDS = [
  { key: 'name', header: 'Supplier Name', required: true, max: 200, note: 'Required. Matched to your existing suppliers ignoring capitals and extra spaces; a name you already have is not added twice.', aliases: ['supplier name', 'supplier', 'name', 'vendor', 'company', 'company name'] },
  { key: 'contact_person', header: 'Contact Person', max: 200, note: 'Optional. Who you deal with at the supplier.', aliases: ['contact person', 'contact', 'contact name', 'representative', 'rep'] },
  { key: 'phone', header: 'Phone Number', max: 40, note: 'Phone or email is needed for a complete record. Digits, spaces, + ( ) - only.', aliases: ['phone number', 'phone', 'mobile', 'telephone', 'tel', 'phone no'] },
  { key: 'email', header: 'Email', max: 200, note: 'Optional. e.g. sales@supplier.com', aliases: ['email', 'email address', 'e mail'] },
  { key: 'address', header: 'Address', max: 500, note: 'Optional.', aliases: ['address', 'office address', 'location'] },
  { key: 'notes', header: 'Notes', max: 1000, note: 'Optional. Terms, account numbers, anything useful.', aliases: ['notes', 'note', 'remarks', 'comments'] },
]
const DETAIL_KEYS = ['contact_person', 'phone', 'email', 'address', 'notes']

const SAMPLE = [
  ['Emzor Distributors', 'Chidi Okeke', '0803 111 2222', 'sales@emzor.example', '12 Industrial Ave, Ikeja', '30 days credit'],
  ['Fidson Healthcare', '', '0809 555 0101', '', 'Obafemi Awolowo Way, Ikeja', ''],
]

const tidyName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** CSV template: headers and two example rows. */
export function buildSupplierTemplateCsv() {
  return '﻿' + [SUPPLIER_FIELDS.map((c) => c.header), ...SAMPLE].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

/** Excel template: a Suppliers sheet (headers, examples) and an Instructions sheet. Text cells keep leading zeros. */
export async function buildSupplierTemplateXlsx() {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet(SUPPLIER_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = SUPPLIER_FIELDS.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(16, c.header.length + 8), style: { numFmt: '@' } }))
  ws.getRow(1).font = { bold: true }
  SAMPLE.forEach((r) => ws.addRow(r))
  const ins = wb.addWorksheet('Instructions')
  ins.columns = [{ header: 'Column', key: 'c', width: 20 }, { header: 'Required', key: 'r', width: 10 }, { header: 'Notes', key: 'n', width: 100 }]
  ins.getRow(1).font = { bold: true }
  SUPPLIER_FIELDS.forEach((c) => ins.addRow({ c: c.header, r: c.required ? 'Yes' : 'No', n: c.note }))
  ins.addRow({})
  ins.addRow({ c: 'One row per supplier. Replace the example rows with your own before uploading.' })
  ins.addRow({ c: 'Balances you owe a supplier are imported separately: Supplier summary › Import › Opening balances.' })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * Rows of cells (the first non-empty row is the header) → { rows: [{ rowNumber, cells }], missing, ignored }.
 * Columns are matched by header in any order; common alternative names are accepted. Throws a user-facing error for
 * an empty or oversized file.
 */
export function readSupplierTable(rawRows) {
  const byAlias = new Map(SUPPLIER_FIELDS.flatMap((c) => [lookupKey(c.header), ...c.aliases.map(lookupKey)].map((a) => [a, c])))
  const indexed = (rawRows || []).map((r, i) => ({ r, n: i + 1 })).filter((x) => (x.r || []).some((c) => String(c ?? '').trim() !== ''))
  if (!indexed.length) throw new Error('The file is empty.')
  const keyByIndex = {}
  const ignored = []
  indexed[0].r.forEach((h, i) => {
    const col = byAlias.get(lookupKey(String(h ?? '').replace(/\*/g, '')))
    if (col && !Object.values(keyByIndex).includes(col.key)) keyByIndex[i] = col.key
    else if (String(h ?? '').trim()) ignored.push(String(h).trim())
  })
  const present = new Set(Object.values(keyByIndex))
  const missing = SUPPLIER_FIELDS.filter((c) => c.required && !present.has(c.key)).map((c) => c.header)
  const rows = indexed.slice(1).map(({ r, n }) => {
    const cells = {}
    Object.entries(keyByIndex).forEach(([i, k]) => { cells[k] = String(r[i] ?? '').trim() })
    return { rowNumber: n, cells }
  })
  if (!missing.length && !rows.length) throw new Error('The file has headers but no rows.')
  if (rows.length > MAX_SUPPLIER_IMPORT_ROWS) throw new Error(`The file has ${rows.length.toLocaleString()} rows; the limit is ${MAX_SUPPLIER_IMPORT_ROWS.toLocaleString()} per upload. Split it into smaller files.`)
  return { rows, missing, ignored }
}

// Statuses a preview row can have. `new` and `fill` rows are saved; the rest are reported.
export const IMPORT_STATUS = {
  new: { label: 'New', type: 'green' },
  fill: { label: 'Adds details', type: 'blue' },
  exists: { label: 'Already in your list', type: 'gray' },
  duplicate: { label: 'Repeated in file', type: 'amber' },
  error: { label: 'Needs fixing', type: 'red' },
}

/**
 * Checks every row against the format rules, the rest of the file and what the business already has.
 *   directory  supplier records ({ id, name, supplier_key, contact_person, phone, email, address, notes })
 *   accounts   supplier accounts from purchases (toAccount shape: { key, name }), for "did you mean" and
 *              "has purchases" notes
 *   fillExisting  true: a name already in the list fills that record's BLANK details from the row (never overwrites)
 * Returns { items: [{ row, name, status, message, warnings: [], record?, fill?, fillable? }], summary }.
 *   fillable  (status exists) the row has details the record lacks; offered with fillExisting
 *   record  the row to insert (status new) · fill { id, changes } (status fill)
 */
export function prepareSupplierImport(rows, { directory = [], accounts = [], fillExisting = false } = {}) {
  const byKey = new Map((directory || []).map((s) => [s.supplier_key || supplierKey(s.name), s]))
  const accountKeys = new Set((accounts || []).map((a) => a.key))
  const known = [
    ...(directory || []).map((s) => ({ key: s.supplier_key || supplierKey(s.name), name: s.name })),
    ...(accounts || []).filter((a) => !byKey.has(a.key)).map((a) => ({ key: a.key, name: a.name })),
  ]
  const firstRowFor = new Map()
  const items = []
  for (const { rowNumber, cells } of rows || []) {
    const name = tidyName(cells.name)
    const values = Object.fromEntries(DETAIL_KEYS.map((k) => [k, String(cells[k] ?? '').trim()]))
    const errs = []
    if (!name) errs.push('The supplier name is missing.')
    for (const f of SUPPLIER_FIELDS) {
      const v = f.key === 'name' ? name : values[f.key]
      if (v && v.length > f.max) errs.push(`${f.header} is too long (${f.max.toLocaleString()} characters at most).`)
    }
    if (!isValidPhone(values.phone)) errs.push(`Phone number "${values.phone}" is not a phone number.`)
    if (!isValidEmail(values.email)) errs.push(`Email "${values.email}" is not an email address.`)
    const item = { row: rowNumber, name, warnings: [] }
    if (errs.length) { items.push({ ...item, status: 'error', message: errs.join(' ') }); continue }

    const key = supplierKey(name)
    if (firstRowFor.has(key)) {
      items.push({ ...item, status: 'duplicate', message: `Same supplier as row ${firstRowFor.get(key)}; only the first is used.` })
      continue
    }
    firstRowFor.set(key, rowNumber)

    const existing = byKey.get(key)
    if (existing) {
      const changes = Object.fromEntries(DETAIL_KEYS.filter((k) => values[k] && !String(existing[k] || '').trim()).map((k) => [k, values[k]]))
      if (fillExisting && Object.keys(changes).length) {
        items.push({ ...item, name: existing.name, status: 'fill', message: `Adds ${Object.keys(changes).map(labelOf).join(', ')} to ${existing.name}.`, fill: { id: existing.id, changes } })
      } else {
        items.push({ ...item, name: existing.name, status: 'exists', fillable: Object.keys(changes).length > 0, message: Object.keys(changes).length ? `${existing.name} is already in your list. Tick "Fill in missing details" to add what this row has.` : `${existing.name} is already in your list.` })
      }
      continue
    }
    // Only a supplier being added can be incomplete: one already listed keeps the details it has.
    if (!values.phone && !values.email) item.warnings.push('Incomplete: no phone number or email.')
    if (accountKeys.has(key)) item.warnings.push('Has purchases already: its account gets these contact details.')
    else {
      const { similar } = matchSupplier(known, name)
      if (similar.length) item.warnings.push(`Did you mean ${similar.map((s) => s.name).join(' or ')}? A different spelling is a separate supplier.`)
    }
    items.push({ ...item, status: 'new', message: '', record: { name, ...values } })
  }
  const count = (s) => items.filter((i) => i.status === s).length
  const summary = {
    rows: items.length, new: count('new'), fill: count('fill'), exists: count('exists'), duplicate: count('duplicate'), errors: count('error'),
    attention: items.filter((i) => i.status === 'error' || i.status === 'duplicate' || i.warnings.length).length,
  }
  return { items, summary }
}

const labelOf = (k) => SUPPLIER_FIELDS.find((f) => f.key === k).header.toLowerCase()

/**
 * One list for the Supplier summary: every supplier account (purchases and supply records) with its record's contact
 * details, plus records without anything supplied yet (shown with zero figures). Same shape as toAccount, plus
 * `record` (or null) and the contact fields.
 */
export function mergeSuppliers(accounts = [], directory = []) {
  const byKey = new Map((directory || []).map((s) => [s.supplier_key || supplierKey(s.name), s]))
  const contact = (s) => ({ record: s || null, contactPerson: s?.contact_person || '', phone: s?.phone || '', email: s?.email || '', address: s?.address || '', notes: s?.notes || '' })
  const seen = new Set()
  const merged = (accounts || []).map((a) => { seen.add(a.key); return { ...a, ...contact(byKey.get(a.key)) } })
  for (const [key, s] of byKey) {
    if (seen.has(key)) continue
    merged.push({ key, name: s.name, purchases: 0, supplies: 0, supplied: 0, paid: 0, balance: 0, open: 0, mismatches: 0, lastSupply: '', ...contact(s) })
  }
  return merged
}

export const SUPPLIER_CONTACT_EXPORT_COLUMNS = [
  { key: 'contactPerson', header: 'Contact Person' },
  { key: 'phone', header: 'Phone Number' },
  { key: 'email', header: 'Email' },
  { key: 'address', header: 'Address' },
  { key: 'notes', header: 'Notes' },
]

/** A record's details as the edit form holds them, and the changes to save (trimmed, only what changed). */
export function supplierFormChanges(record, form) {
  const changes = {}
  const name = tidyName(form.name)
  if (!record || name !== record.name) changes.name = name
  for (const k of DETAIL_KEYS) {
    const v = String(form[k] ?? '').trim()
    if (!record || v !== String(record[k] || '')) changes[k] = v
  }
  return changes
}

/** Format checks for the edit form; '' when it can be saved. */
export function validateSupplierForm(form, record) {
  const name = tidyName(form.name)
  if (!name) return 'Enter the supplier name.'
  if (record && supplierKey(name) !== supplierKey(record.name)) return 'The name can only be corrected in capitals or spacing: purchases are recorded under it.'
  for (const f of SUPPLIER_FIELDS) {
    const v = f.key === 'name' ? name : String(form[f.key] ?? '').trim()
    if (v.length > f.max) return `${f.header} is too long (${f.max.toLocaleString()} characters at most).`
  }
  if (!isValidPhone(form.phone)) return 'Enter a valid phone number (digits, spaces, + ( ) - only).'
  if (!isValidEmail(form.email)) return 'Enter a valid email address.'
  return ''
}
