// ── Sales & Accounts report: the arithmetic ──────────────────────────────────
// Pure functions, no React and no network, so every figure the cashier hands
// to the owner is pinned by a test (salesReport.test.js). The page and the
// exports both read from here; nothing recomputes a total on its own.
//
// The rules that make the figures reconcile (design:
// docs/superpowers/specs/2026-10-25-pos-sales-report-design.md):
//   * A sale counts on the day it was made; money counts on the day it came in.
//     Sales come from `sales`, money from the `sale_payments` ledger.
//   * Money received at the till is least(amount_paid, total): the cash path
//     stores the cash tendered, so change handed back is never counted.
//   * Held, resumed-but-abandoned and deleted rows are not sales.
//   * Cashier and shift filters follow the sale for sales figures and the
//     person who took the money for money figures.
//   * No cost or profit figure is produced here, by design.

import { businessPeriod, parseDbTime, BUSINESS_TZ } from '../../lib/businessDay'

export const METHODS = ['Cash', 'Transfer', 'POS']
export const SALE_METHODS = ['Cash', 'Transfer', 'POS', 'Split', 'Credit']
export const STATUSES = ['Paid', 'Part-paid', 'Unpaid', 'Refund']
export const PERIODS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'],
  ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom'],
]
export const EMPTY_FILTERS = Object.freeze({ customer: '', product: '', method: '', status: '', cashier: '', shift: '' })

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
// Kobo-safe rounding for sums of naira amounts.
const money = (v) => Math.round(num(v) * 100) / 100
const emptyByMethod = () => ({ total: 0, Cash: 0, Transfer: 0, POS: 0, Unspecified: 0 })

// ── Time ──────────────────────────────────────────────────────────────────────

// Days are business days (lib/businessDay.js): the same "today" as the
// dashboard and Financial Reports, whatever zone or date the device is set to.
// Weeks start on Monday. Custom ranges are inclusive of both days; a reversed
// or unreadable custom range returns null rather than a silently swapped one.
export { parseDbTime }
export function periodRange(period, { now = new Date(), from, to } = {}) {
  return businessPeriod(period, { now, from, to })
}

// ── Reading a sale ────────────────────────────────────────────────────────────

export const isCompletedSale = (s) => !s?.is_on_hold && (s?.status == null || s.status === 'completed')

// `sales.items` is jsonb, but the app writes JSON.stringify(...) into it, so a
// row may hold an array, a JSON string of one, or (older rows) a string of a
// string. All three read as the array.
export function parseItems(items) {
  let v = items
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v) } catch (e) { return [] }
  }
  return Array.isArray(v) ? v : []
}

function parseSplit(split) {
  let v = split
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v) } catch (e) { return null }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

export const saleReceived = (s) => money(Math.min(num(s.amount_paid), num(s.total)))
export const saleOutstanding = (s) => money(Math.max(num(s.total) - saleReceived(s), 0))
export const saleRefunded = (s) => money(s.refunded_amount)
// What a sale is worth to the business once refunds are taken off: the figure
// revenue, the dashboard and Financial Reports add up.
export const saleNet = (s) => money(Math.max(num(s.total) - saleRefunded(s), 0))

export function paymentStatus(s) {
  if (saleOutstanding(s) <= 0) return 'Paid'
  return saleReceived(s) > 0 ? 'Part-paid' : 'Unpaid'
}

// How the till money of one sale splits across methods — the client mirror of
// pos_split_payments() in the database, used only when the ledger is missing.
function tillByMethod(s) {
  const out = emptyByMethod()
  let left = saleReceived(s)
  if (left <= 0) return out
  const split = s.payment_method === 'Split' || s.payment_method === 'Credit' ? parseSplit(s.payment_split) : null
  let any = false
  if (split) {
    for (const m of ['Transfer', 'POS', 'Cash']) {
      const amt = num(split[m])
      if (amt > 0 && left > 0) {
        const take = Math.min(amt, left)
        out[m] += take; left -= take; any = true
      }
    }
    if (any && left > 0) { out.Unspecified += left; left = 0 }
  }
  if (!any) out[METHODS.includes(s.payment_method) ? s.payment_method : 'Unspecified'] += left
  out.total = saleReceived(s)
  return out
}

export function methodLabel(s) {
  if (s.payment_method === 'Split') {
    const split = parseSplit(s.payment_split)
    const used = split ? METHODS.filter((m) => num(split[m]) > 0) : []
    return used.length ? `Split (${used.join(', ')})` : 'Split'
  }
  return s.payment_method || 'Cash'
}

// ── Keys used by the filters ──────────────────────────────────────────────────

export const customerKey = (s) => (s.client_id ? 'id:' + s.client_id : 'name:' + String(s.client_name || 'Walk-in').trim().toLowerCase())
const itemKey = (it) => String(it.id ?? it.product_id ?? 'name:' + String(it.name || '').toLowerCase())
// The same identity space for a sale's cashier and a payment's receiver: the
// auth user id when the database stamped one, else the free-text name older
// rows carry, else "none".
export const cashierKey = (row) => {
  const uid = row.cashier_user_id ?? row.received_by
  if (uid) return uid
  return row.staff_name ? 'name:' + row.staff_name : 'none'
}
const shiftKey = (row) => row.shift_id || 'none'

function saleMatches(s, f) {
  if (f.customer && customerKey(s) !== f.customer) return false
  if (f.product && !parseItems(s.items).some((it) => itemKey(it) === f.product)) return false
  if (f.method && s.payment_method !== f.method) return false
  if (f.status === 'Refund') { if (!(saleRefunded(s) > 0)) return false }
  else if (f.status && paymentStatus(s) !== f.status) return false
  return true
}

export function filterSales(sales, f = EMPTY_FILTERS) {
  return (sales || []).filter((s) => isCompletedSale(s) && saleMatches(s, f) &&
    (!f.cashier || cashierKey(s) === f.cashier) && (!f.shift || shiftKey(s) === f.shift))
}

export function filterPayments(payments, salesById, f = EMPTY_FILTERS) {
  const saleLevel = f.customer || f.product || f.method || f.status
  return (payments || []).filter((p) => {
    if (f.cashier && cashierKey(p) !== f.cashier) return false
    if (f.shift && shiftKey(p) !== f.shift) return false
    if (!saleLevel) return true
    const s = salesById[p.sale_id]
    return !!s && saleMatches(s, f)
  })
}

// ── The summary ───────────────────────────────────────────────────────────────

// Total sales: the gross value of completed sales, before refunds (refunds are
// reported on their own, on the day the money went back). The one rule every
// "Sales today" / "Total sales" figure uses: dashboard, Overview, Locations
// and Sales & Accounts.
export const sumTotalSales = (sales) => money((sales || []).reduce((n, s) => n + num(s.total), 0))

// When the Owner deletes a sale, delete_sale() appends 'refund' rows noted
// "Sale deleted: …" to reverse the money (carehub_20261216). They are not
// money handed back to a customer, so they are reported as reversals, not
// refunds; net received counts both.
export const isDeletionReversal = (p) => p.kind === 'refund' && /^Sale deleted:/.test(String(p.note || ''))

// `payments` are the ledger rows already filtered for the view; `ledgerAvailable`
// false means the ledger table is not deployed yet, so money figures are
// estimated from the sales themselves and flagged `estimated`.
export function summarise({ sales = [], payments = [], ledgerAvailable = true }) {
  const received = emptyByMethod()
  const refunds = emptyByMethod()
  const reversals = emptyByMethod()
  let collections = 0
  const tillPaid = {}

  if (ledgerAvailable) {
    for (const p of payments) {
      const amt = num(p.amount)
      const m = p.method in received ? p.method : 'Unspecified'
      if (isDeletionReversal(p)) { reversals[m] += amt; reversals.total += amt; continue }
      if (p.kind === 'refund') { refunds[m] += amt; refunds.total += amt; continue }
      received[m] += amt; received.total += amt
      if (p.kind === 'collection') collections += amt
      else tillPaid[p.sale_id] = (tillPaid[p.sale_id] || 0) + amt
    }
  } else {
    for (const s of sales) {
      const t = tillByMethod(s)
      for (const k of Object.keys(received)) received[k] += t[k]
      const r = saleRefunded(s)
      refunds.Unspecified += r; refunds.total += r
      tillPaid[s.id] = saleReceived(s)
    }
  }

  let discounts = 0
  let outstanding = 0
  const credit = { count: 0, amount: 0 }
  for (const s of sales) {
    discounts += num(s.discount)
    outstanding += saleOutstanding(s)
    const unpaidAtTill = num(s.total) - (tillPaid[s.id] || 0)
    if (unpaidAtTill > 0.004) { credit.count++; credit.amount += unpaidAtTill }
  }

  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)]))
  return {
    totalSales: sumTotalSales(sales),
    discounts: money(discounts),
    transactions: sales.length,
    outstanding: money(outstanding),
    credit: { count: credit.count, amount: money(credit.amount) },
    received: round(received),
    collections: money(collections),
    refunds: round(refunds),
    reversals: round(reversals),
    netReceived: money(received.total - refunds.total - reversals.total),
    cashInHand: money(received.Cash - refunds.Cash - reversals.Cash),
    estimated: !ledgerAvailable,
  }
}

// The filtered sales, payments and summary for one view of the report data
// (useSalesReportData). Sales & Accounts and the dashboard both call this, so
// "Sales today" on the dashboard is the same number, from the same rows and
// the same arithmetic, as "Total sales" for Today in Sales & Accounts.
export function reportView(data, filters = EMPTY_FILTERS) {
  const sales = filterSales(data?.sales, filters)
  const payments = filterPayments(data?.payments, data?.salesById || {}, filters)
  return { sales, payments, summary: summarise({ sales, payments, ledgerAvailable: data?.ledgerAvailable !== false }) }
}

// Cash that should be in the drawer for one shift: opening float + cash taken
// (sales and repayments) − cash refunded. Mirrors close_pos_shift(), which is
// the figure of record; this is the preview shown before closing.
export function expectedCash(shift, payments = []) {
  let cash = num(shift?.opening_float)
  for (const p of payments) {
    if (p.shift_id !== shift?.id || p.method !== 'Cash') continue
    cash += p.kind === 'refund' ? -num(p.amount) : num(p.amount)
  }
  return money(cash)
}

// ── Rows for the table and the exports ────────────────────────────────────────

const timeFmt = (d) => (d ? d.toLocaleString('en-NG', { timeZone: BUSINESS_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export function shiftLabel(shift) {
  if (!shift) return 'No shift'
  return `${shift.staff_name || 'Unknown'} · ${timeFmt(parseDbTime(shift.opened_at))}`
}

export function toReportRows(sales, { shiftsById = {} } = {}) {
  return (sales || []).map((s) => {
    const items = parseItems(s.items)
    return {
      saleId: s.id,
      receipt: s.txn_no || '',
      date: parseDbTime(s.created_at),
      customer: s.client_name || 'Walk-in',
      products: items.map((it) => `${it.name || 'Item'} ×${num(it.qty) || 1}`).join(', '),
      quantity: items.reduce((n, it) => n + (num(it.qty) || 1), 0),
      total: money(s.total),
      discount: money(s.discount),
      paid: saleReceived(s),
      outstanding: saleOutstanding(s),
      refunded: saleRefunded(s),
      method: methodLabel(s),
      status: paymentStatus(s),
      cashier: s.staff_name || 'Not recorded',
      shift: s.shift_id ? shiftLabel(shiftsById[s.shift_id] || { staff_name: 'Shift' }) : 'No shift',
    }
  })
}

// ── Filter choices present in the period ──────────────────────────────────────

const sortByLabel = (m) => [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))

export function filterOptions(sales = [], payments = [], shifts = []) {
  const customers = new Map()
  const products = new Map()
  const cashiers = new Map()
  for (const s of sales) {
    customers.set(customerKey(s), s.client_name || 'Walk-in')
    for (const it of parseItems(s.items)) if (!products.has(itemKey(it))) products.set(itemKey(it), it.name || 'Item')
    const ck = cashierKey(s)
    if (ck !== 'none') cashiers.set(ck, s.staff_name || 'Unknown')
  }
  for (const p of payments) {
    const ck = cashierKey(p)
    if (ck !== 'none' && !cashiers.has(ck)) cashiers.set(ck, p.staff_name || 'Unknown')
  }
  return {
    customers: sortByLabel(customers),
    products: sortByLabel(products),
    cashiers: sortByLabel(cashiers),
    shifts: (shifts || []).map((sh) => ({ value: sh.id, label: shiftLabel(sh) + (sh.closed_at ? '' : ' (open)') })),
  }
}
