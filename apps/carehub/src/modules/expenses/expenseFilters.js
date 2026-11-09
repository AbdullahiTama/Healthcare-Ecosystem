// The Expenses page filter: which expenses a combination of filters leaves, and the totals for them. Pure, so the page
// and its tests share one definition. Dates use expenseDate() (the date entered, else the day it was recorded), the
// same rule as the database's expense_effective_date() and the Reports page.
import { periodBounds } from '../../lib/datePeriods'
import { normText, matchesText, inAmountRange, inPeriod, isAmountRangeSet, amountRangeLabel } from '../../lib/recordFilters'
import { expenseDate, sumExpenses, sumByCategory } from './expenseRules'

export function defaultExpenseFilters(month) {
  return { search: '', period: { mode: 'month', month }, category: '', recordedBy: '', amount: { min: '', max: '' } }
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
    inAmountRange(e.amount, f.amount))
}

// Newest first by the expense's own date, then by when it was recorded.
export function sortExpenses(list) {
  return [...(list || [])].sort((a, b) =>
    expenseDate(b).localeCompare(expenseDate(a)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

// Totals for the expenses shown: amount (whole kobo), count, and the category breakdown, largest first.
export function expenseTotals(list) {
  const byCategory = Object.entries(sumByCategory(list)).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)
  return { total: sumExpenses(list), count: (list || []).length, byCategory }
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
  return [!!(f.search || '').trim(), b.from !== def.from || b.to !== def.to, !!f.category, !!f.recordedBy, isAmountRangeSet(f.amount)]
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
    amount && `amount ${amount}`,
  ].filter(Boolean).join(' · ')
}
