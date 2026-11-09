// Building blocks shared by the record filters on Debts, Clients and Expenses: text search, an amount range and a
// date period. Pure functions, no React, so each page's filter (debts/debtFilters.js, clients/clientFilters.js,
// expenses/expenseFilters.js) composes the same rules and the pages cannot drift apart.
//
// Periods come from lib/datePeriods (periodBounds): inclusive 'YYYY-MM-DD' { from, to }, either end open.

// Lower case, single spaces, trimmed: "  Musa  BELLO " and "musa bello" compare equal.
export function normText(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Does any of `values` contain the search text? An empty search matches everything.
export function matchesText(values, query) {
  const q = normText(query)
  if (!q) return true
  return (values || []).some((v) => normText(v).includes(q))
}

// An amount box as typed ("1,500", " 200 "). Blank or not a number is no bound (null), so a half-typed value never
// hides every record.
export function parseBound(raw) {
  const s = String(raw ?? '').replace(/[,\s₦]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Is `value` within { min, max } (strings as typed, inclusive)? A reversed range is read the right way round.
export function inAmountRange(value, range) {
  let min = parseBound(range?.min)
  let max = parseBound(range?.max)
  if (min === null && max === null) return true
  if (min !== null && max !== null && min > max) [min, max] = [max, min]
  const n = Number(value) || 0
  return (min === null || n >= min) && (max === null || n <= max)
}

export function isAmountRangeSet(range) {
  return parseBound(range?.min) !== null || parseBound(range?.max) !== null
}

// "₦1,000 to ₦5,000", "at least ₦1,000", "up to ₦5,000", or '' when no bound is set.
export function amountRangeLabel(range, fmt) {
  let min = parseBound(range?.min)
  let max = parseBound(range?.max)
  if (min !== null && max !== null && min > max) [min, max] = [max, min]
  if (min !== null && max !== null) return `${fmt(min)} to ${fmt(max)}`
  if (min !== null) return `at least ${fmt(min)}`
  if (max !== null) return `up to ${fmt(max)}`
  return ''
}

// Is a record's date inside the period? `date` is anything starting 'YYYY-MM-DD' (a date or a timestamp); only the
// calendar day is compared, so no time zone can move a record across a boundary. With a period set, a record with
// no usable date is left out rather than guessed into it.
export function inPeriod(date, bounds) {
  if (!bounds || (!bounds.from && !bounds.to)) return true
  const day = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  return (!bounds.from || day >= bounds.from) && (!bounds.to || day <= bounds.to)
}

// The years offered by a period filter: every year that has a record, newest first, always including this year.
export function yearsOf(dates, today) {
  const years = new Set([String(today).slice(0, 4)])
  for (const d of dates || []) {
    const y = String(d || '').slice(0, 4)
    if (/^\d{4}$/.test(y)) years.add(y)
  }
  return [...years].sort((a, b) => b.localeCompare(a))
}
