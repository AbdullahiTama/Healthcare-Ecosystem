// The Expenses page filter: which expenses a combination of filters leaves, and the totals for them. Pure, so the page
// and its tests share one definition. Dates use expenseDate() (the date entered, else the day it was recorded), the
// same rule as the database's expense_effective_date() and the Reports page.
import { periodBounds } from '../../lib/datePeriods'
import { normText, matchesText, inAmountRange, inPeriod, isAmountRangeSet, amountRangeLabel } from '../../lib/recordFilters'
import { expenseDate, sumExpenses, sumByCategory, expensePaid, expensePaymentStatus } from './expenseRules'

export const EXPENSE_PAYMENT_STATUSES = [['unpaid', 'Unpaid'], ['partial', 'Partially paid'], ['paid', 'Paid']]

export function defaultExpenseFilters(month) {
  return { search: '', period: { mode: 'month', month }, category: '', recordedBy: '', paymentStatus: '', amount: { min: '', max: '' } }
}

// Who an expense was recorded by: the signed-in person the database stamped, else the name typed on the form.
export const expenseRecorder = (e) => (e?.recorded_by_name || e?.staff_name || '').trim()

export function filterExpenses(expenses, filters) {
  const f = filters || {}
  const bounds = periodBounds(f.period)
  return (expenses || []).filter((e) =>
    matchesText([e.description, e.category, e.staff_name, e.recorded_by_name], f.search) &&
    inPeriod(expenseDate(e), bounds) &&
    (!f.category || e.category === f.category) &&
    (!f.recordedBy || normText(expenseRecorder(e)) === normText(f.recordedBy)) &&
    (!f.paymentStatus || expensePaymentStatus(e) === f.paymentStatus) &&
    inAmountRange(e.amount, f.amount))
}

// Newest first by the expense's own date, then by when it was recorded.
export function sortExpenses(list) {
  return [...(list || [])].sort((a, b) =>
    expenseDate(b).localeCompare(expenseDate(a)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

// Totals for the expenses shown, in whole kobo: spent (incurred), paid, still owed (with how many are not fully
// paid), count, and the category breakdown, largest first.
export function expenseTotals(list) {
  const byCategory = Object.entries(sumByCategory(list)).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)
  const total = sumExpenses(list)
  const paidKobo = (list || []).reduce((k, e) => k + Math.round(expensePaid(e) * 100), 0)
  const open = (list || []).filter((e) => expensePaymentStatus(e) !== 'paid').length
  return { total, paid: paidKobo / 100, outstanding: Math.round(total * 100 - paidKobo) / 100, open, count: (list || []).length, byCategory }
}

// Everyone who has recorded an expense, for the "Recorded by" choice.
export function expenseRecorders(expenses) {
  const seen = new Map()
  for (const e of expenses || []) {
    const name = expenseRecorder(e)
    if (name && !seen.has(normText(name))) seen.set(normText(name), name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// The default view (this month) is not counted as a filter.
export function activeExpenseFilterCount(filters, month) {
  const f = filters || {}
  const def = periodBounds({ mode: 'month', month })
  const b = periodBounds(f.period)
  return [!!(f.search || '').trim(), b.from !== def.from || b.to !== def.to, !!f.category, !!f.recordedBy, !!f.paymentStatus, isAmountRangeSet(f.amount)]
    .filter(Boolean).length
}

export function describeExpenseFilters(filters, { fmt } = {}) {
  const f = filters || {}
  const b = periodBounds(f.period)
  const amount = fmt ? amountRangeLabel(f.amount, fmt) : ''
  return [
    (f.search || '').trim() && `"${f.search.trim()}"`,
    b.label,
    f.category,
    f.recordedBy && `recorded by ${f.recordedBy}`,
    (EXPENSE_PAYMENT_STATUSES.find(([k]) => k === f.paymentStatus) || [])[1],
    amount && `amount ${amount}`,
  ].filter(Boolean).join(' · ')
}
