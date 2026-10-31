// Pure figures for the purchase history screen, kept out of the component so
// they can be tested on their own.

import { periodDays } from '../../lib/datePeriods'

// How often purchases happen over the period: "3 per week", "about every 5
// days", "1 in this period". With an open period (all time) the span from the
// first to the last purchase is used.
export function purchaseFrequency(count, { from, to }, { firstDate, lastDate } = {}) {
  const n = Number(count) || 0
  if (n === 0) return null
  const days = periodDays({ from, to }) ?? (firstDate && lastDate ? periodDays({ from: String(firstDate).slice(0, 10), to: String(lastDate).slice(0, 10) }) : null)
  if (!days || n === 1) return n === 1 ? '1 purchase' + (days ? ' in ' + days + ' day' + (days === 1 ? '' : 's') : '') : null
  const perWeek = (n / days) * 7
  if (perWeek >= 1) return Math.round(perWeek * 10) / 10 + ' per week'
  const every = Math.round(days / n)
  return 'about every ' + every + ' days'
}

// Percentage change from `before` to `now`, rounded; null when either is missing.
export function priceChange(now, before) {
  const a = Number(now)
  const b = Number(before)
  if (!(a > 0) || !(b > 0)) return null
  return Math.round(((a - b) / b) * 100)
}

// A row's share of a total, as a whole percentage.
export function share(part, total) {
  const t = Number(total) || 0
  return t > 0 ? Math.round(((Number(part) || 0) / t) * 100) : 0
}
