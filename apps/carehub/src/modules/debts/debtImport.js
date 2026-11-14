// Excel / CSV import and export of debts: Receivables (customers who owe the business) and Payables (suppliers and
// others the business owes; on the Purchases page these are supply records without products).
//
// Pure: reading the file's table, checking each cell's format and building the rows for import_debts. Matching a row
// to an existing customer or supplier, creating a missing one, spotting duplicates and recording payments all happen
// in the database (carehub_20270117), under one lock per business, so the preview (a dry run of the same function)
// and the import can never disagree and two imports can never create the same customer twice.
//
// One spreadsheet row is either a debt (Amount Owed filled in, optionally part paid) or a payment on the party's
// account (only Amount Paid filled in). Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §2.

import { lookupKey } from '../business-directory/services/normalize'
import { parseImportDate, parseImportNumber } from '../purchases/purchaseImport'

export const MAX_DEBT_IMPORT_ROWS = 2000
export const MAX_DEBT_IMPORT_BYTES = 5 * 1024 * 1024
export const PAYMENT_METHODS = ['Cash', 'Transfer', 'POS', 'Cheque', 'Other']

const common = (partyHeader, partyAliases, amountHeader, amountAliases, direction) => [
  { key: 'party', header: partyHeader, required: true, note: `${partyHeader} name. Matched to an existing ${direction === 'owes_us' ? 'customer (by phone first, then by name)' : 'supplier (by name, ignoring capitals and extra spaces)'}; a new name ${direction === 'owes_us' ? 'creates the customer' : 'starts that supplier\'s account'}.`, aliases: partyAliases },
  ...(direction === 'owes_us' ? [{ key: 'phone', header: 'Phone', required: false, note: 'Optional. The surest way to find the right customer (+234 and 0 forms both work).', aliases: ['phone', 'phone number', 'mobile', 'telephone', 'tel'] }] : []),
  { key: 'date', header: 'Date', required: false, note: 'When the debt arose or the payment was made. YYYY-MM-DD or DD/MM/YYYY. Blank: today.', aliases: ['date', 'transaction date', 'supply date', 'invoice date', 'payment date'] },
  { key: 'amount', header: amountHeader, required: false, note: 'What is owed. Leave blank (or 0) for a row that is only a payment.', aliases: amountAliases },
  { key: 'paid', header: 'Amount Paid (NGN)', required: false, note: 'With an amount owed: what was already paid on it. Alone: a payment on the account, applied to the oldest balances first.', aliases: ['amount paid ngn', 'amount paid', 'paid', 'payment', 'payment amount'] },
  { key: 'dueDate', header: 'Due Date', required: false, note: 'Optional. When the balance is due.', aliases: ['due date', 'due', 'payment due'] },
  { key: 'description', header: 'Description', required: false, note: 'Optional. What the debt is for.', aliases: ['description', 'details', 'note', 'notes', 'narration', 'remarks'] },
  { key: 'reference', header: 'Reference', required: false, note: 'Optional but recommended (invoice or receipt number): a row whose reference is already recorded is skipped, so a file can be uploaded twice safely.', aliases: ['reference', 'ref', 'invoice', 'invoice no', 'invoice number', 'receipt', 'receipt no'] },
  { key: 'method', header: 'Payment Method', required: false, note: 'For amounts paid: ' + PAYMENT_METHODS.join(', ') + '.', aliases: ['payment method', 'method', 'paid by', 'mode'] },
]

export const DEBT_IMPORT = {
  owes_us: {
    sheet: 'Receivables',
    title: 'Receivables',
    partyNoun: 'customer',
    columns: common('Customer', ['customer', 'customer name', 'client', 'client name', 'name', 'debtor', 'party'], 'Amount Owed (NGN)', ['amount owed ngn', 'amount owed', 'amount', 'debt', 'total', 'owed'], 'owes_us'),
    sample: [
      ['Ada Obi', '0803 111 2222', '2026-10-02', '15000', '5000', '2026-11-30', 'Medicines on credit', 'INV-2041', 'Cash'],
      ['Ada Obi', '0803 111 2222', '2026-10-20', '', '4000', '', 'Part payment', 'RCPT-118', 'Transfer'],
    ],
  },
  we_owe: {
    sheet: 'Payables',
    title: 'Payables',
    partyNoun: 'supplier',
    columns: common('Supplier', ['supplier', 'supplier name', 'vendor', 'creditor', 'name', 'party'], 'Amount Supplied / Owed (NGN)', ['amount supplied owed ngn', 'amount supplied ngn', 'amount supplied', 'supply value', 'amount owed', 'amount', 'total', 'owed'], 'we_owe'),
    sample: [
      ['Emzor Distributors', '2026-09-14', '250000', '100000', '2026-10-14', 'Opening balance (before CareHub)', 'EMZ-0914', 'Transfer'],
      ['Emzor Distributors', '2026-10-01', '', '50000', '', 'Payment on account', 'TRF-5531', 'Transfer'],
    ],
  },
}

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** CSV template: headers and two example rows (a debt part paid, then a payment) to replace. */
export function buildDebtTemplateCsv(direction) {
  const cfg = DEBT_IMPORT[direction]
  return '﻿' + [cfg.columns.map((c) => c.header), ...cfg.sample].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

/** Excel template: the data sheet (headers and examples) and an Instructions sheet. */
export async function buildDebtTemplateXlsx(direction) {
  const cfg = DEBT_IMPORT[direction]
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet(cfg.sheet, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cfg.columns.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(14, c.header.length + 6), style: { numFmt: '@' } }))
  ws.getRow(1).font = { bold: true }
  cfg.sample.forEach((r) => ws.addRow(r))
  const ins = wb.addWorksheet('Instructions')
  ins.columns = [{ header: 'Column', key: 'c', width: 26 }, { header: 'Required', key: 'r', width: 10 }, { header: 'Notes', key: 'n', width: 100 }]
  ins.getRow(1).font = { bold: true }
  cfg.columns.forEach((c) => ins.addRow({ c: c.header, r: c.required ? 'Yes' : 'No', n: c.note }))
  ins.addRow({})
  ins.addRow({ c: 'One row per debt, or per payment. Replace the example rows with your own before uploading.' })
  if (direction === 'owes_us') ins.addRow({ c: 'Payments apply to debts recorded here or imported. Credit sales are paid at POS › Credit, where the money enters the till.' })
  else ins.addRow({ c: 'Payments apply to the supplier\'s purchases and supply records, oldest first, exactly like Record payment on the supplier account.' })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * Rows of cells (the first non-empty row is the header) → { rows, missing, ignored }. Columns are matched by header in
 * any order (common alternative names accepted). Throws a user-facing error for an empty or oversized file.
 */
export function readDebtTable(rawRows, direction) {
  const cfg = DEBT_IMPORT[direction]
  const byAlias = new Map(cfg.columns.flatMap((c) => [lookupKey(c.header), ...c.aliases.map(lookupKey)].map((a) => [a, c])))
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
  const missing = cfg.columns.filter((c) => c.required && !present.has(c.key)).map((c) => c.header)
  if (!present.has('amount') && !present.has('paid')) missing.push(cfg.columns.find((c) => c.key === 'amount').header + ' or Amount Paid (NGN)')
  const rows = indexed.slice(1).map(({ r, n }) => {
    const cells = {}
    Object.entries(keyByIndex).forEach(([i, k]) => { cells[k] = String(r[i] ?? '').trim() })
    return { rowNumber: n, cells }
  })
  if (!rows.length) throw new Error('The file has headers but no rows.')
  if (rows.length > MAX_DEBT_IMPORT_ROWS) throw new Error(`The file has ${rows.length.toLocaleString()} rows; the limit is ${MAX_DEBT_IMPORT_ROWS.toLocaleString()} per upload. Split it into smaller files.`)
  return { rows, missing, ignored }
}

/**
 * Checks each cell's format and builds import_debts rows. Rows with a format problem are reported here and not sent;
 * everything else (who the party is, duplicates, balances) is checked by the database.
 * Returns { payload: [{ row, party, phone, date, amount, paid, due_date, description, reference, method }],
 *           problems: [{ row, party, message }] }.
 */
export function prepareDebtRows(rows, { today } = {}) {
  const payload = []
  const problems = []
  for (const { rowNumber, cells } of rows) {
    const errs = []
    const party = String(cells.party || '').trim()
    if (!party) errs.push('The name is missing.')
    const amount = parseImportNumber(cells.amount)
    const paid = parseImportNumber(cells.paid)
    if (Number.isNaN(amount) || (amount !== '' && amount < 0)) errs.push(`Amount owed "${cells.amount}" is not a valid amount.`)
    if (Number.isNaN(paid) || (paid !== '' && paid < 0)) errs.push(`Amount paid "${cells.paid}" is not a valid amount.`)
    const a = Number.isNaN(amount) || amount === '' ? 0 : amount
    const p = Number.isNaN(paid) || paid === '' ? 0 : paid
    if (!errs.length && a <= 0 && p <= 0) errs.push('Enter the amount owed, or the amount paid for a payment.')
    if (!errs.length && a > 0 && p > a) errs.push(`Amount paid (${p}) is more than the amount owed (${a}).`)
    const date = parseImportDate(cells.date)
    if (date === null) errs.push(`Date "${cells.date}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`)
    else if (date && today && date > today) errs.push(`Date ${date} is in the future.`)
    const due = parseImportDate(cells.dueDate)
    if (due === null) errs.push(`Due date "${cells.dueDate}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`)
    const methodText = String(cells.method || '').trim()
    const method = methodText ? PAYMENT_METHODS.find((m) => m.toLowerCase() === methodText.toLowerCase()) : ''
    if (methodText && !method) errs.push(`Payment method "${methodText}" is not one of ${PAYMENT_METHODS.join(', ')}.`)
    if (String(cells.reference || '').length > 100) errs.push('The reference is too long (100 characters at most).')
    if (String(cells.description || '').length > 1000) errs.push('The description is too long (1,000 characters at most).')
    if (errs.length) { problems.push({ row: rowNumber, party, message: errs.join(' ') }); continue }
    payload.push({
      row: rowNumber, party, phone: String(cells.phone || '').trim(), date: date || '', amount: a, paid: p,
      due_date: due || '', description: String(cells.description || '').trim(), reference: String(cells.reference || '').trim(), method: method || '',
    })
  }
  return { payload, problems }
}

/** The database's answer and the format problems, as one list in file order, with a summary. */
export function mergeImportResult(result, problems = []) {
  const rows = [
    ...(result?.rows || []),
    ...problems.map((p) => ({ row: p.row, status: 'error', party: p.party || null, message: p.message })),
  ].sort((a, b) => (a.row || 0) - (b.row || 0))
  const summary = { ...(result?.summary || {}), errors: (result?.summary?.errors || 0) + problems.length, rows: (result?.summary?.rows || 0) + problems.length }
  return { rows, summary }
}

// ── Export ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The reference an exported debt carries; import_debts recognises it, so an exported file uploaded again is skipped.
export const debtRef = (d) => 'D-' + String(d?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase()

const SOURCE_LABEL = { credit_sale: 'Credit sale', purchase: 'Purchase', manual: 'Recorded by hand' }
const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : '')
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export function debtExportColumns(direction) {
  const cfg = DEBT_IMPORT[direction]
  return [
    ...cfg.columns.filter((c) => c.key !== 'method').map((c) => ({ key: c.key, header: c.header })),
    { key: 'balance', header: 'Balance (NGN)' },
    { key: 'status', header: 'Status' },
    { key: 'source', header: 'Source' },
    { key: 'linked', header: direction === 'owes_us' ? 'Customer Record' : 'Linked' },
  ]
}

/** Debts → export rows, in the import template's columns (so a corrected file can be uploaded again). */
export function debtExportRows(debts, { clientsById = new Map(), statusLabel = (d) => d.status } = {}) {
  return (debts || []).map((d) => {
    const client = d.client_id ? clientsById.get(String(d.client_id)) : null
    return {
      party: d.party_name || '',
      phone: client?.phone || '',
      date: day(d.created_at),
      amount: num(d.amount),
      paid: num(d.amount_paid),
      dueDate: day(d.due_date),
      description: d.description || '',
      reference: debtRef(d),
      balance: Math.max(0, num(d.balance)),
      status: statusLabel(d),
      source: SOURCE_LABEL[d.source || 'manual'] || d.source,
      linked: d.client_id ? 'Yes' : 'No',
    }
  })
}
