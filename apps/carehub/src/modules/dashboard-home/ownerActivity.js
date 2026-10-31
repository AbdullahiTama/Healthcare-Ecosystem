// ── The Owner's business activity: the rules ─────────────────────────────────
// Pure, so what the Owner is told about (and what is left out) is pinned by a
// test (ownerActivity.test.js). The rows come from staff_activity(), the
// Owner-only feed (carehub_20261229_owner_financial_activity.sql); this file
// only chooses, groups and links them.
//
// Routine sales are deliberately not here: the dashboard already shows them in
// "Recent sales", and listing every sale would bury the records an owner needs
// to see (purchases, supplier payments, expenses, credit, refunds, changes).

import { kindLabel } from '../staff/staffActivity'
import { businessDate, businessDateOf, businessTime, parseDbTime } from '../../lib/businessDay'

export const CATEGORIES = [
  ['all', 'All'],
  ['suppliers', 'Purchases & suppliers'],
  ['expenses', 'Expenses'],
  ['credit', 'Credit & debts'],
  ['changes', 'Refunds & changes'],
]

const CATEGORY_OF_KIND = {
  purchase: 'suppliers',
  supplier_payment: 'suppliers',
  expense: 'expenses',
  credit_sale: 'credit',
  debt: 'credit',
  repayment: 'credit',
  refund: 'changes',
  sale_edited: 'changes',
  sale_deleted: 'changes',
  shift_close: 'changes',
}

export const categoryOf = (row) => CATEGORY_OF_KIND[row?.kind] || null

// A row the Owner should hear about. A closed shift only when the cash counted
// differs from what was expected (amount = counted − expected).
export function isOwnerWorthy(row) {
  if (!categoryOf(row)) return false
  if (row.kind === 'shift_close') return Math.abs(Number(row.amount) || 0) >= 0.01
  return true
}

export function selectOwnerActivity(rows, { category = 'all' } = {}) {
  return (rows || []).filter((r) => isOwnerWorthy(r) && (category === 'all' || categoryOf(r) === category))
}

export function countByCategory(rows) {
  const counts = Object.fromEntries(CATEGORIES.map(([k]) => [k, 0]))
  for (const r of rows || []) {
    if (!isOwnerWorthy(r)) continue
    counts.all++
    counts[categoryOf(r)]++
  }
  return counts
}

// Money going out or coming back, or a record being changed, reads as a warning;
// everything else is information.
export function toneOf(row) {
  if (['refund', 'sale_deleted', 'sale_edited'].includes(row.kind)) return 'warning'
  if (row.kind === 'shift_close') return 'danger'
  if (row.kind === 'credit_sale' || row.kind === 'debt') return 'brand'
  return 'info'
}

// Where clicking the row takes the Owner: the record itself.
//   { sale: txn_no }  open the sale in full on the dashboard
//   { path }          a screen that opens the record from its query string
export function recordTarget(row) {
  const ref = row?.ref ? String(row.ref) : ''
  switch (row?.kind) {
    case 'credit_sale': case 'refund': case 'repayment': case 'sale_edited': case 'sale_deleted':
      return ref ? { sale: ref } : null
    case 'purchase': case 'supplier_payment':
      return ref ? { path: '/dashboard/purchases?purchase=' + encodeURIComponent(ref) } : { path: '/dashboard/purchases' }
    case 'expense':
      return ref ? { path: '/dashboard/expenses?expense=' + encodeURIComponent(ref) } : { path: '/dashboard/expenses' }
    case 'debt':
      return ref ? { path: '/dashboard/debts?debt=' + encodeURIComponent(ref) } : { path: '/dashboard/debts' }
    case 'shift_close':
      return { path: '/dashboard/pos/report' }
    default:
      return null
  }
}

// "Rep One (Cashier) · Today 14:20" / "… · 29 Oct 09:05". Business time.
export function describeWhoWhen(row, { now = new Date() } = {}) {
  const who = row.actor_role ? `${row.actor_name} (${row.actor_role})` : (row.actor_name || 'Owner or unlinked')
  const at = parseDbTime(row.occurred_at)
  if (!at) return who
  const day = businessDateOf(row.occurred_at)
  const today = businessDate(now)
  const yesterday = businessDate(new Date(now.getTime() - 864e5))
  const label = day === today ? 'Today' : day === yesterday ? 'Yesterday'
    : at.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' })
  return `${who} · ${label} ${businessTime(row.occurred_at)}`
}

export const describeWhat = (row) => `${kindLabel(row.kind)} · ${row.summary || ''}`.replace(/ · $/, '')

// Rows newer than the Owner's last look at this section are "new".
export const isNew = (row, lastSeenIso) => !!lastSeenIso && (parseDbTime(row.occurred_at)?.getTime() || 0) > (parseDbTime(lastSeenIso)?.getTime() || 0)

// ── Follow-ups ────────────────────────────────────────────────────────────────

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const money = (v) => Math.round(num(v) * 100) / 100
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

// What still needs paying or chasing, for the highlight tiles:
//   suppliers     what the business owes its suppliers (get_supplier_balances)
//   overdueBills  debts the business owes, past their due date (supplier
//                 invoices included: a purchase on credit opens such a debt)
//   overdueOwed   money owed to the business on debts past their due date,
//                 other than credit sales (the dashboard's "Owed to you"
//                 already covers those)
export function followUps({ supplierBalances = [], debts = [], today = businessDate() } = {}) {
  const owing = (supplierBalances || []).filter((s) => num(s.balance) > 0.004)
  const open = (debts || []).filter((d) => d.status !== 'paid' && num(d.balance) > 0.004)
  const overdue = (d) => isDate(d.due_date) && d.due_date < today
  const bills = open.filter((d) => d.direction !== 'owes_us' && overdue(d))
  const owed = open.filter((d) => d.direction === 'owes_us' && d.source !== 'credit_sale' && overdue(d))
  const sum = (arr, k) => money(arr.reduce((n, x) => n + num(x[k]), 0))
  const byBalance = (a, b) => num(b.balance) - num(a.balance)
  return {
    suppliers: { count: owing.length, amount: sum(owing, 'balance'), top: [...owing].sort(byBalance).slice(0, 3) },
    overdueBills: { count: bills.length, amount: sum(bills, 'balance'), top: [...bills].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3) },
    overdueOwed: { count: owed.length, amount: sum(owed, 'balance'), top: [...owed].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3) },
  }
}

// The last seven business days, today included.
export function activityWindow(now = new Date()) {
  const today = businessDate(now)
  const weekAgo = businessDate(new Date(now.getTime() - 6 * 864e5))
  return { from: weekAgo, to: today }
}
