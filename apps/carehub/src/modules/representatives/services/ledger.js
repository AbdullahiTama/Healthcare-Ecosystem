// Pure rules for the representative ledger screens. Every figure comes from the database (rep_statement /
// rep_ledger_summary); nothing here recomputes a balance. This file only labels, validates input before it is sent,
// shapes the summary view, and turns refusals into sentences. See docs/architecture/Importer-Operating-Models.md.
import { refusalMessage } from '../../../lib/dbErrors'
import { businessDate } from '../../../lib/businessDay'

export const MODELS = {
  centralised: {
    label: 'Centralised',
    short: 'One company POS and stock; representatives sign in as staff.',
    points: [
      'The company sets official prices; representatives cannot change them unless a role allows it.',
      'Representatives sell through the company POS and inventory, under their own staff login.',
      'Each representative has an account statement for goods supplied, payments, returns and transfers.',
    ],
  },
  decentralised: {
    label: 'Decentralised',
    short: 'Each representative runs their own account with their own POS, stock and prices.',
    points: [
      'Each representative has a private account: their own POS, stock, selling prices, sales and records.',
      'Representatives can view the company catalogue and prices, but cannot sell through the company account.',
      'Goods supplied on credit move from the company stock to the representative, and their statement records what they owe.',
    ],
  },
}

export const ENTRY_TYPES = {
  supply: 'Supply on credit',
  payment: 'Payment',
  return: 'Return',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
}
export const entryTypeLabel = (t) => ENTRY_TYPES[t] || t

export const PAYMENT_METHODS = [
  ['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['pos', 'POS / card'], ['cheque', 'Cheque'], ['mobile_money', 'Mobile money'], ['other', 'Other'],
]
export const RETURN_CONDITIONS = [['good', 'Good (back to stock)'], ['damaged', 'Damaged'], ['expired', 'Expired']]

export const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Default statement period: the first of this month to today, in the business calendar (what the database dates
// entries with).
export function defaultPeriod(now = new Date()) {
  const to = businessDate(now)
  return { from: to.slice(0, 8) + '01', to }
}

export function validPeriod({ from, to }) {
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(from || '') || !re.test(to || '')) return 'Choose a start and an end date.'
  if (from > to) return 'The start date must be on or before the end date.'
  return null
}

// What the balance means, in words. Positive = the representative owes the company.
export function positionText(balance) {
  const n = Number(balance || 0)
  if (n > 0) return `Owes the company ${money(n)}`
  if (n < 0) return `In credit by ${money(-n)}`
  return 'Settled: nothing owed'
}

// Rows of the summary statement, in reading order, from rep_statement's totals.
export function summaryRows(st) {
  const t = st?.totals || {}
  return [
    ['Opening balance (brought forward)', st?.opening_balance ?? 0, 'balance'],
    ['Supplies on credit', t.supplies, 'debit'],
    ['Transfers in', t.transfers_in, 'debit'],
    ['Other debits (adjustments, reversals)', t.adjustments_debit, 'debit'],
    ['Payments received', t.payments, 'credit'],
    ['Accepted returns', t.returns, 'credit'],
    ['Transfers out', t.transfers_out, 'credit'],
    ['Other credits (adjustments, reversals)', t.adjustments_credit, 'credit'],
    ['Closing balance (carried forward)', st?.closing_balance ?? 0, 'balance'],
  ]
}

// Detailed statement rows (one per entry) for the screen and both exports.
export function detailRows(st) {
  return (st?.entries || []).map((e) => ({
    date: e.entry_date,
    entryNo: e.entry_no,
    reference: e.reference || '',
    description: describeEntry(e),
    debit: Number(e.debit || 0),
    credit: Number(e.credit || 0),
    balance: Number(e.running_balance || 0),
  }))
}

export function describeEntry(e) {
  const parts = [e.description || entryTypeLabel(e.entry_type)]
  const items = (e.lines || []).map((l) => `${l.quantity} × ${l.product_name}`)
  if (items.length) parts.push(items.join(', '))
  if (e.entry_type === 'payment') parts.push([methodLabel(e.payment_method), e.payment_recipient && `received by ${e.payment_recipient}`].filter(Boolean).join(', '))
  if (e.reason && e.entry_type !== 'adjustment') parts.push(e.reason)
  return parts.filter(Boolean).join(' · ')
}

export const methodLabel = (m) => (PAYMENT_METHODS.find(([k]) => k === m) || [null, m || ''])[1]

// Product lines typed into a form: [{ product, qty, unitValue }] → the database shape, or the first problem.
export function toLines(rows) {
  const lines = []
  const seen = new Set()
  for (const r of rows || []) {
    if (!r.product) return { error: 'Choose a product on every line, or remove the empty line.' }
    if (seen.has(r.product.id)) return { error: `${r.product.name} is listed twice. Combine the quantities.` }
    seen.add(r.product.id)
    const qty = Number(r.qty)
    if (!Number.isInteger(qty) || qty <= 0) return { error: `Enter a whole-number quantity for ${r.product.name}.` }
    const unit = Number(r.unitValue)
    if (r.unitValue === '' || r.unitValue == null || !Number.isFinite(unit) || unit < 0) return { error: `Enter a value of zero or more for ${r.product.name}.` }
    lines.push({ product_id: r.product.id, qty, unit_value: Math.round(unit * 100) / 100 })
  }
  if (lines.length === 0) return { error: 'Add at least one product.' }
  return { lines, total: lines.reduce((s, l) => s + Math.round(l.qty * l.unit_value * 100) / 100, 0) }
}

export function positiveAmount(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

// Database refusals arrive as sentences; stock refusals from the stock ledger arrive coded.
export function repLedgerError(e, fallback = 'Could not complete this. Check your connection and try again.') {
  const raw = String(e?.message || '')
  const stockShort = raw.match(/INSUFFICIENT_STOCK: (?:product|batch) holds (-?\d+) but (\d+) was requested/)
  if (stockShort) return `Not enough stock: ${stockShort[1]} available, ${stockShort[2]} needed.`
  if (/PRODUCT_NOT_FOUND/.test(raw)) return 'A product in this entry no longer exists.'
  if (/BATCH_REQUIRED/.test(raw)) return 'This product is tracked by batch, so it cannot move to or from a representative yet.'
  return refusalMessage(e, fallback)
}

// The custody plan sent with a switch to Decentralised: only lines the owner changed.
export function stockPlan(preview, edits) {
  const plan = []
  for (const r of preview?.representatives || []) {
    for (const s of r.stock || []) {
      const k = `${r.id}:${s.company_product_id}`
      if (edits && Object.prototype.hasOwnProperty.call(edits, k) && s.company_product_id) {
        const qty = Number(edits[k])
        if (!Number.isInteger(qty) || qty < 0 || qty > s.custody) {
          return { error: `The quantity for ${s.product_name} (${r.full_name}) must be a whole number from 0 to ${s.custody}.` }
        }
        plan.push({ representative_id: r.id, company_product_id: s.company_product_id, qty })
      }
    }
  }
  return { plan }
}
