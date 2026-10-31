import { businessDate, businessDateOf, businessPeriod } from '../../lib/businessDay'

// Financial Reports periods, on the business day (lib/businessDay.js): the same
// "today", Monday-to-Sunday "week", month and year as the dashboard and Sales &
// Accounts, whatever zone or date the device is set to.

// The [start, end) business dates of a period, or null for 'all' (or a bad month).
function dateBounds({ period, month, now }) {
  const r = businessPeriod(period, { now, month })
  if (!r) return null
  // `end` is the next period's first midnight, so its business date is the
  // first date outside the period.
  return { from: businessDate(r.start), to: businessDate(r.end) }
}

// Whether an item's date falls inside the selected report period.
// Takes its options as one object so it can never be handed to Array.filter
// directly: filter's (item, index, array) arguments would otherwise land in
// the wrong parameters. `dateOf` may return a time (placed in the business
// zone) or a bare business date such as an expense date.
export function inPeriod(item, { period, month, now = new Date(), dateOf = i => i.created_at || '' }) {
  if (period === 'all') return true
  const bounds = dateBounds({ period, month, now })
  if (!bounds) return true
  const d = businessDateOf(dateOf(item))
  return !!d && d >= bounds.from && d < bounds.to
}

// The server-side window for a period, as ISO instants: { from, to } with `to`
// exclusive, or nulls for 'all'. Covers exactly what inPeriod accepts, so a
// screen can ask the database for just the period, then filter with inPeriod.
export function periodRange({ period, month, now = new Date() }) {
  const r = period === 'all' ? null : businessPeriod(period, { now, month })
  return r ? { from: r.start.toISOString(), to: r.end.toISOString() } : { from: null, to: null }
}
