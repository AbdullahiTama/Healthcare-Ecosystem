// Client upload (Excel / CSV) with opening balances. Pure checks plus one save step with injected repositories.
//
// A row is a client: Client Name and Phone Number required (phone is the duplicate check, as for Add Client), address
// and the optional details, and an optional opening balance: what the client owed the business, or the business owed
// the client, before CareHub. An opening balance is recorded as an OPENING ENTRY, never as a sale or a payment: a
// hand-recorded debt linked to the client (source 'manual', source_ref 'opening_balance'), dated on the opening date,
// "owes_us" for Client Owes Us and "we_owe" for We Owe Client. It shows in the client's position, in Debt Management
// (Receivables or Payables) and in the account, and is paid like any recorded debt. The database allows one per
// client (debts_one_opening_balance_per_client), so a file uploaded twice cannot record it twice.
// Docs: docs/architecture/Client-Position-and-Opening-Balances.md.
import { lookupKey, isValidEmail } from '../business-directory/services/normalize'
import { parseImportDate, parseImportNumber } from '../purchases/purchaseImport'
import { CLIENT_GENDERS } from './clientBulkEdit'
import { phoneDigits } from './clientEdit'

export const MAX_CLIENT_IMPORT_ROWS = 5000
export const MAX_CLIENT_IMPORT_BYTES = 5 * 1024 * 1024
export const CLIENT_SHEET = 'Clients'
export const OPENING_SOURCE_REF = 'opening_balance'
export const BALANCE_TYPES = { owes_us: 'Client Owes Us', we_owe: 'We Owe Client' }

export const CLIENT_IMPORT_FIELDS = [
  { key: 'name', header: 'Client Name', required: true, note: 'Required. Full name.', aliases: ['client name', 'name', 'full name', 'customer', 'customer name', 'patient', 'patient name'] },
  { key: 'phone', header: 'Phone Number', required: true, note: 'Required. Clients are matched by phone number: one already in your list is not added again.', aliases: ['phone number', 'phone', 'mobile', 'telephone', 'tel', 'phone no'] },
  { key: 'address', header: 'Address', note: 'Optional.', aliases: ['address', 'home address'] },
  { key: 'openingBalance', header: 'Opening Balance', note: 'Optional. The balance before CareHub, in naira (e.g. 15000). Leave blank or 0 for none.', aliases: ['opening balance', 'opening balance ngn', 'balance', 'opening amount'] },
  { key: 'balanceType', header: 'Balance Type', note: 'Needed with an opening balance: "Client Owes Us" (the client owes you) or "We Owe Client" (you owe the client, e.g. a deposit or advance).', aliases: ['balance type', 'type', 'opening balance type', 'dr cr'] },
  { key: 'openingDate', header: 'Opening Balance Date', note: 'Needed with an opening balance: the date the balance stood at. YYYY-MM-DD or DD/MM/YYYY; not in the future.', aliases: ['opening balance date', 'balance date', 'as at', 'as of', 'opening date'] },
  { key: 'email', header: 'Email', note: 'Optional.', aliases: ['email', 'email address', 'e mail'] },
  { key: 'gender', header: 'Gender', note: 'Optional: Male, Female or Other.', aliases: ['gender', 'sex'] },
  { key: 'dob', header: 'Date of Birth', note: 'Optional. YYYY-MM-DD or DD/MM/YYYY.', aliases: ['date of birth', 'dob', 'birthday', 'birth date'] },
  { key: 'notes', header: 'Notes', note: 'Optional.', aliases: ['notes', 'note', 'remarks'] },
  // The previous template's split name is still read, so old files keep working.
  { key: 'firstName', header: 'First Name', legacy: true, aliases: ['first name', 'firstname', 'given name'] },
  { key: 'lastName', header: 'Last Name', legacy: true, aliases: ['last name', 'surname', 'lastname', 'family name'] },
]
const TEMPLATE_FIELDS = CLIENT_IMPORT_FIELDS.filter((f) => !f.legacy)
const SAMPLE = [
  ['Ada Okafor', '08012345678', '12 Broad Street, Lagos', '15000', 'Client Owes Us', '2026-10-31', 'ada@email.com', 'Female', '1990-05-12', 'VIP customer'],
  ['Musa Bello', '08098765432', '', '5000', 'We Owe Client', '2026-10-31', '', 'Male', '', 'Paid in advance'],
  ['Chi Eze', '08033334444', 'Yaba', '', '', '', '', '', '', ''],
]

const csvEscape = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }

/** CSV template: headers and three example rows (owes us, we owe, no balance). */
export function buildClientTemplateCsv() {
  return '﻿' + [TEMPLATE_FIELDS.map((c) => c.header), ...SAMPLE].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

/** Excel template: a Clients sheet (text cells, so phone numbers keep their leading 0) and an Instructions sheet. */
export async function buildClientTemplateXlsx() {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet(CLIENT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = TEMPLATE_FIELDS.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(14, c.header.length + 6), style: { numFmt: '@' } }))
  ws.getRow(1).font = { bold: true }
  SAMPLE.forEach((r) => ws.addRow(r))
  // Balance Type as a drop-down, so it is always spelled the way the import reads it.
  for (let r = 2; r <= 1001; r++) {
    ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${BALANCE_TYPES.owes_us},${BALANCE_TYPES.we_owe}"`] }
  }
  const ins = wb.addWorksheet('Instructions')
  ins.columns = [{ header: 'Column', key: 'c', width: 22 }, { header: 'Required', key: 'r', width: 10 }, { header: 'Notes', key: 'n', width: 100 }]
  ins.getRow(1).font = { bold: true }
  TEMPLATE_FIELDS.forEach((c) => ins.addRow({ c: c.header, r: c.required ? 'Yes' : 'No', n: c.note }))
  ins.addRow({})
  ins.addRow({ c: 'One row per client. Replace the example rows with your own before uploading.' })
  ins.addRow({ c: 'Opening balances are recorded as opening entries on the client\'s account, not as sales or payments. One per client.' })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * Rows of cells (first non-empty row is the header) → { rows: [{ rowNumber, cells }], missing, ignored }. Columns are
 * matched by header in any order; the old template (First Name / Last Name) is read too.
 */
export function readClientTable(rawRows) {
  const byAlias = new Map(CLIENT_IMPORT_FIELDS.flatMap((c) => [lookupKey(c.header), ...c.aliases.map(lookupKey)].map((a) => [a, c])))
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
  const missing = []
  if (!present.has('name') && !present.has('firstName')) missing.push('Client Name')
  if (!present.has('phone')) missing.push('Phone Number')
  const rows = indexed.slice(1).map(({ r, n }) => {
    const cells = {}
    Object.entries(keyByIndex).forEach(([i, k]) => { cells[k] = String(r[i] ?? '').trim() })
    return { rowNumber: n, cells }
  })
  if (!missing.length && !rows.length) throw new Error('The file has headers but no clients.')
  if (rows.length > MAX_CLIENT_IMPORT_ROWS) throw new Error(`The file has ${rows.length.toLocaleString()} rows; the limit is ${MAX_CLIENT_IMPORT_ROWS.toLocaleString()} per upload. Split it into smaller files.`)
  return { rows, missing, ignored }
}

/** "Client Owes Us", "owes us", "receivable", "DR"… → 'owes_us'; "We Owe Client", "credit", "advance"… → 'we_owe'; else null. */
export function parseBalanceType(text) {
  const k = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!k) return ''
  if (['clientowesus', 'owesus', 'clientowes', 'receivable', 'debit', 'dr', 'debtor', 'owed', 'owedtous'].includes(k)) return 'owes_us'
  if (['weoweclient', 'weowe', 'weoweclients', 'credit', 'cr', 'payable', 'creditor', 'advance', 'deposit', 'clientcredit'].includes(k)) return 'we_owe'
  return null
}

/**
 * An opening balance from its three cells: { opening: { direction, amount, date } | null, error, note }. A blank or zero
 * amount means none (a note says so if the other two cells were filled).
 */
export function readOpening({ amount, type, date }, { today } = {}) {
  const a = parseImportNumber(amount)
  const hasOther = String(type ?? '').trim() || String(date ?? '').trim()
  if (a === '' || a === 0) return { opening: null, error: '', note: hasOther ? 'Balance type or date given without an opening balance amount: no opening balance recorded.' : '' }
  if (Number.isNaN(a) || a < 0) return { opening: null, error: `Opening balance "${amount}" is not an amount (use a number such as 15000; choose the direction in Balance Type).` }
  const direction = parseBalanceType(type)
  if (direction === '') return { opening: null, error: 'Choose the Balance Type: Client Owes Us or We Owe Client.' }
  if (direction === null) return { opening: null, error: `Balance Type "${type}" is not Client Owes Us or We Owe Client.` }
  const d = parseImportDate(date)
  if (d === '') return { opening: null, error: 'Enter the Opening Balance Date.' }
  if (d === null) return { opening: null, error: `Opening Balance Date "${date}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).` }
  if (today && d > today) return { opening: null, error: `Opening Balance Date ${d} is in the future.` }
  return { opening: { direction, amount: Math.round(a * 100) / 100, date: d }, error: '', note: '' }
}

/**
 * Checks every row against the format rules, the rest of the file and the clients the business already has.
 * Returns { items, summary }; items: [{ row, name, phone, status, message, warnings, record?, clientId?, opening? }]
 *   new        a client to add (record), with its opening balance if any
 *   exists     the phone number belongs to a client already in the list: not added again; an opening balance on the
 *              row is added to THAT client (clientId) unless they already have one (the database refuses a second)
 *   duplicate  the same phone number as an earlier row: only the first is used
 *   error      needs fixing (message); nothing from the row is saved
 */
//   allowOpenings  false: opening balances are not recorded (a note says so); only the Owner or a manager records them
export function prepareClientImport(rows, { clients = [], today, allowOpenings = true } = {}) {
  const byPhone = new Map()
  for (const c of clients || []) { const d = phoneDigits(c.phone); if (d && !byPhone.has(d)) byPhone.set(d, c) }
  const firstRow = new Map()
  const items = []
  for (const { rowNumber, cells } of rows || []) {
    const name = String(cells.name || [cells.firstName, cells.lastName].filter((x) => String(x || '').trim()).join(' ')).trim().replace(/\s+/g, ' ')
    const phone = String(cells.phone || '').trim()
    const digits = phoneDigits(phone)
    const errs = []
    if (!name) errs.push('The client name is missing.')
    if (!phone) errs.push('The phone number is missing.')
    else if (/[a-z]/i.test(phone) || digits.length < 7 || digits.length > 15) errs.push(`Phone number "${phone}" is not a phone number (7 to 15 digits).`)
    if (name.length > 200) errs.push('The name is too long (200 characters at most).')
    const email = String(cells.email || '').trim()
    if (!isValidEmail(email)) errs.push(`Email "${email}" is not an email address.`)
    const genderText = String(cells.gender || '').trim()
    const gender = genderText ? CLIENT_GENDERS.find((g) => g.toLowerCase() === genderText.toLowerCase() || g[0].toLowerCase() === genderText.toLowerCase()) : ''
    if (gender === undefined) errs.push(`Gender "${genderText}" is not Male, Female or Other.`)
    const dob = parseImportDate(cells.dob)
    if (dob === null) errs.push(`Date of birth "${cells.dob}" is not a date.`)
    else if (dob && today && dob > today) errs.push('The date of birth is in the future.')
    const address = String(cells.address || '').trim()
    if (address.length > 300) errs.push('The address is too long (300 characters at most).')
    const read = readOpening({ amount: cells.openingBalance, type: cells.balanceType, date: cells.openingDate }, { today })
    let opening = read.opening
    const warnings = read.note ? [read.note] : []
    if (allowOpenings && read.error) errs.push(read.error)
    if (!allowOpenings && (opening || read.error)) {
      opening = null
      warnings.push('Opening balance not recorded: only the Owner or a manager can record opening balances.')
    }
    const item = { row: rowNumber, name, phone, warnings, opening }
    if (errs.length) { items.push({ ...item, opening: null, status: 'error', message: errs.join(' ') }); continue }
    if (firstRow.has(digits)) { items.push({ ...item, opening: null, status: 'duplicate', message: `Same phone number as row ${firstRow.get(digits)}; only the first is used.` }); continue }
    firstRow.set(digits, rowNumber)
    const existing = byPhone.get(digits)
    if (existing) {
      items.push({ ...item, name: existing.full_name || name, status: 'exists', clientId: existing.id,
        message: opening ? `${existing.full_name} is already in your list: the opening balance is added to their account.` : `${existing.full_name} is already in your list.` })
      continue
    }
    items.push({
      ...item, status: 'new', message: '',
      record: { full_name: name, phone, email, address, gender: gender || '', date_of_birth: dob || '', notes: String(cells.notes || '').trim().slice(0, 2000), total_spend: 0, visit_count: 0 },
    })
  }
  const count = (s) => items.filter((i) => i.status === s).length
  const withOpening = items.filter((i) => i.opening)
  const sum = (dir) => Math.round(withOpening.filter((i) => i.opening.direction === dir).reduce((t, i) => t + i.opening.amount * 100, 0)) / 100
  return {
    items,
    summary: {
      rows: items.length, new: count('new'), exists: count('exists'), duplicate: count('duplicate'), errors: count('error'),
      openings: withOpening.length, owesUs: sum('owes_us'), weOwe: sum('we_owe'),
      attention: items.filter((i) => i.status === 'error' || i.status === 'duplicate' || i.warnings.length).length,
    },
  }
}

/** The opening entry for a client: a hand-recorded debt linked to them, dated on the opening date. */
export function openingDebt(client, opening) {
  return {
    direction: opening.direction, party_name: client.full_name, client_id: client.id,
    amount: opening.amount, amount_paid: 0, balance: opening.amount, status: 'pending',
    description: 'Opening balance', source: 'manual', source_ref: OPENING_SOURCE_REF, due_date: '',
    created_at: opening.date,
  }
}

const isDuplicate = (e) => /duplicate key|23505|already exists/i.test(String(e?.message || ''))

/**
 * Records opening balances: [{ client: { id, full_name }, opening }] → { recorded: [names], already: [names],
 * failed: [{ name, message }] }. A client who already has one is reported, not changed.
 */
export async function recordOpeningBalances(businessId, entries, { debtRepo }) {
  const recorded = []
  const already = []
  const failed = []
  for (const { client, opening } of entries) {
    try {
      await debtRepo.create(businessId, openingDebt(client, opening))
      recorded.push(client.full_name)
    } catch (e) {
      if (isDuplicate(e)) already.push(client.full_name)
      else failed.push({ name: client.full_name, message: e?.message || 'Could not save' })
    }
  }
  return { recorded, already, failed }
}

/**
 * Saves a checked file: adds the new clients, then records the opening balances (for the clients just added and for
 * clients already in the list). A client the database reports as a duplicate (added meanwhile) is skipped and so is
 * its opening balance; uploading the file again adds it.
 * Returns { added, skipped, failed, openings: { recorded, already, failed } }.
 */
export async function commitClientImport(businessId, items, { createMany, debtRepo }) {
  const fresh = items.filter((i) => i.status === 'new')
  const created = fresh.length ? await createMany(fresh.map((i) => i.record)) : { added: 0, skipped: 0, failed: [], created: [] }
  const createdByPhone = new Map((created.created || []).map((c) => [phoneDigits(c.phone), c]))
  const entries = []
  for (const i of items) {
    if (!i.opening) continue
    if (i.status === 'new') {
      const c = createdByPhone.get(phoneDigits(i.phone))
      if (c) entries.push({ client: c, opening: i.opening })
    } else if (i.status === 'exists') {
      entries.push({ client: { id: i.clientId, full_name: i.name }, opening: i.opening })
    }
  }
  const openings = entries.length ? await recordOpeningBalances(businessId, entries, { debtRepo }) : { recorded: [], already: [], failed: [] }
  return { added: created.added, skipped: created.skipped, failed: created.failed, openings }
}
