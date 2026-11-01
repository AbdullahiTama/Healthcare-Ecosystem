// Date periods for filters: a specific day, the week around a day, a month, a
// year, or a custom range — turned into an inclusive { from, to } pair of
// 'YYYY-MM-DD' dates a server function can take as `date` arguments.
//
// Dates stay strings end to end. Calendar arithmetic is done on UTC midnights,
// so no time zone or daylight-saving shift can move a boundary by a day; "today"
// comes from the caller (lib/utils todayDate(), the device's local date).
//
// Reports' periodFilter.js answers a different question (rolling windows over
// created_at timestamps for the sales report) and is deliberately left alone.

const pad = (n) => String(n).padStart(2, '0')
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const toUtc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const fromUtc = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`

export function isIsoDay(s) {
  if (!ISO_DAY.test(s || '')) return false
  return fromUtc(toUtc(s)) === s   // rejects 2026-02-30
}

export function addDays(iso, n) {
  const dt = toUtc(iso)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUtc(dt)
}

// Weeks run Monday to Sunday (the working week in Nigeria and ISO 8601).
export function weekOf(iso) {
  const dow = (toUtc(iso).getUTCDay() + 6) % 7   // Monday = 0
  const from = addDays(iso, -dow)
  return { from, to: addDays(from, 6) }
}

export function monthOf(ym) {
  const [y, m] = ym.split('-').map(Number)
  return { from: `${ym}-01`, to: fromUtc(new Date(Date.UTC(y, m, 0))) }
}

export const PERIOD_MODES = [
  ['all', 'All time'],
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
  ['range', 'Custom range'],
]

export const ALL_TIME = Object.freeze({ mode: 'all' })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }

// { from, to, label } for a period. `from`/`to` are null for an open end. An
// incomplete or invalid period (a day mode with no date picked yet) is all time,
// so a half-filled control never hides every record.
export function periodBounds(period) {
  const p = period || ALL_TIME
  if (p.mode === 'day' && isIsoDay(p.date)) return { from: p.date, to: p.date, label: dayLabel(p.date) }
  if (p.mode === 'week' && isIsoDay(p.date)) {
    const w = weekOf(p.date)
    return { ...w, label: `Week of ${dayLabel(w.from)} to ${dayLabel(w.to)}` }
  }
  if (p.mode === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month || '')) {
    const [y, m] = p.month.split('-').map(Number)
    return { ...monthOf(p.month), label: `${MONTHS[m - 1]} ${y}` }
  }
  if (p.mode === 'year' && /^\d{4}$/.test(String(p.year || ''))) {
    return { from: `${p.year}-01-01`, to: `${p.year}-12-31`, label: String(p.year) }
  }
  if (p.mode === 'range') {
    let from = isIsoDay(p.from) ? p.from : null
    let to = isIsoDay(p.to) ? p.to : null
    if (from && to && from > to) [from, to] = [to, from]
    if (from || to) {
      const label = from && to ? `${dayLabel(from)} to ${dayLabel(to)}` : from ? `From ${dayLabel(from)}` : `Up to ${dayLabel(to)}`
      return { from, to, label }
    }
  }
  return { from: null, to: null, label: 'All time' }
}

// One-tap presets, resolved against the caller's today.
export function presetPeriod(key, today) {
  switch (key) {
    case 'today': return { mode: 'day', date: today }
    case 'yesterday': return { mode: 'day', date: addDays(today, -1) }
    case 'this_week': return { mode: 'week', date: today }
    case 'last_week': return { mode: 'week', date: addDays(today, -7) }
    case 'this_month': return { mode: 'month', month: today.slice(0, 7) }
    case 'last_month': return { mode: 'month', month: addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7) }
    case 'last_30': return { mode: 'range', from: addDays(today, -29), to: today }
    case 'this_year': return { mode: 'year', year: today.slice(0, 4) }
    default: return ALL_TIME
  }
}

export const PRESETS = [
  ['today', 'Today'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['last_30', 'Last 30 days'],
  ['this_year', 'This year'],
]

// Number of days a period spans (inclusive), or null when an end is open.
export function periodDays({ from, to }) {
  if (!from || !to) return null
  return Math.round((toUtc(to) - toUtc(from)) / 864e5) + 1
}
