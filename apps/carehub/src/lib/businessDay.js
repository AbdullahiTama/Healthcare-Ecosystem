// ── The business day ─────────────────────────────────────────────────────────
// One definition of "today", "this week", "this month" and "this year" for every
// financial screen (dashboard, Overview, Sales & Accounts, Financial Reports).
//
// Days are cut in the business's time zone, not the device's and not UTC:
//   * UTC put 00:00–01:00 Lagos time on the previous day, so a late sale landed
//     on different days on different screens.
//   * The device's zone made the same account show different figures on a
//     phone set to another zone or the wrong date.
// CareHub businesses are in Nigeria today, so the zone is fixed. A per-business
// setting can replace BUSINESS_TZ later without touching any caller.
//
// Everything here works on instants (Date) and calendar dates ('YYYY-MM-DD')
// and goes through Intl, so the device's own zone never leaks in.
//
// Database times: `sales.created_at` is `timestamp without time zone` holding
// UTC, which PostgREST returns with no zone; `parseDbTime` reads such a value as
// UTC. Range bounds are sent as `Date#toISOString()`: for a zone-less column
// Postgres ignores the trailing Z and compares the UTC wall clock (correct),
// and for a `timestamptz` column it compares the instant (also correct).

export const BUSINESS_TZ = 'Africa/Lagos'

const pad2 = (n) => String(n).padStart(2, '0')
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function zonedParts(date) {
  const out = {}
  for (const p of partsFormatter.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

// The zone's offset from UTC at an instant, in milliseconds.
function offsetAt(ms) {
  const p = zonedParts(new Date(ms))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

// A database time value as a Date. A value with no zone is UTC (see above).
export function parseDbTime(v) {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const s = String(v)
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)
  const d = new Date(hasZone ? s : s + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

// The business calendar date of an instant, 'YYYY-MM-DD'.
export function businessDate(date = new Date()) {
  const p = zonedParts(date)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

// The business calendar date a stored value belongs to. A bare date (an
// expense date, a supply date) is already a business date; a time is placed
// in the business zone. '' when the value is missing or unreadable.
export function businessDateOf(value) {
  if (!value) return ''
  const s = String(value)
  if (DATE_RE.test(s)) return s
  const d = parseDbTime(s)
  return d ? businessDate(d) : ''
}

// "HH:MM" in the business zone, for lists that show when a sale happened.
export function businessTime(value) {
  const d = parseDbTime(value)
  if (!d) return ''
  const p = zonedParts(d)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

// "YYYY-MM-DD HH:MM" in the business zone.
export function businessDateTime(value) {
  const d = parseDbTime(value)
  return d ? `${businessDate(d)} ${businessTime(d)}` : ''
}

// The instant a business date starts (its midnight in the business zone).
// Accepts out-of-range days/months (day 0, day 32, month 13) and normalises them.
export function startOfBusinessDate(y, m, d) {
  const guess = Date.UTC(y, m - 1, d)
  let ms = guess - offsetAt(guess)
  // A second pass settles a day on which the offset changes (DST zones).
  ms = guess - offsetAt(ms)
  return new Date(ms)
}

function parseDate(s) {
  const m = DATE_RE.exec(String(s || ''))
  if (!m) return null
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  const check = new Date(Date.UTC(y, mo - 1, d))
  return check.getUTCMonth() === mo - 1 ? { y, m: mo, d } : null
}

const dayStart = ({ y, m, d }, plusDays = 0) => startOfBusinessDate(y, m, d + plusDays)

// The period as [start, end) instants. Weeks start on Monday. A custom range is
// inclusive of both dates; a reversed or unreadable one returns null rather
// than a silently swapped range. `month` ('YYYY-MM') picks a month for 'month';
// an unreadable one (a cleared month input) returns null.
export function businessPeriod(period, { now = new Date(), from, to, month } = {}) {
  const today = parseDate(businessDate(now))
  switch (period) {
    case 'today': return { start: dayStart(today), end: dayStart(today, 1) }
    case 'yesterday': return { start: dayStart(today, -1), end: dayStart(today) }
    case 'week': {
      const weekday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay()
      const back = (weekday + 6) % 7
      return { start: dayStart(today, -back), end: dayStart(today, 7 - back) }
    }
    case 'month': {
      // No month given: this month. A month given but unreadable: no range.
      const mm = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
      if (month !== undefined && !mm) return null
      const y = mm ? +mm[1] : today.y
      const mo = mm ? +mm[2] : today.m
      if (mo < 1 || mo > 12) return null
      return { start: startOfBusinessDate(y, mo, 1), end: startOfBusinessDate(y, mo + 1, 1) }
    }
    case 'year': return { start: startOfBusinessDate(today.y, 1, 1), end: startOfBusinessDate(today.y + 1, 1, 1) }
    case 'custom': {
      const a = parseDate(from)
      const b = parseDate(to)
      if (!a || !b || dayStart(a) > dayStart(b)) return null
      return { start: dayStart(a), end: dayStart(b, 1) }
    }
    default: return null
  }
}

// Milliseconds until the next business midnight: screens showing "today"
// schedule a refresh for then, so a page left open overnight moves on.
export function msUntilNextBusinessDay(now = new Date()) {
  return Math.max(businessPeriod('today', { now }).end.getTime() - now.getTime(), 0)
}
