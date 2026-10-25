// What the Customers screens can narrow by. Pure, so the rules are tested on their own.

export const NOT_VISITED_CHOICES = [[0, 'Any time'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']]

// field_customers returns at most this many (the most recently visited); the screens say so when it is reached.
export const LIST_LIMIT = 500

const DAY_MS = 86400000

// search      name or address contains it (case-insensitive)
// territoryId the customer's territory (from its most recent visit that had one)
// staffId     that rep visited it at least once
// notVisitedDays  > 0: last visited MORE than that many days ago ("going quiet")
export function filterCustomers(rows, { search = '', territoryId = '', staffId = '', notVisitedDays = 0, now = Date.now() } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const cutoff = notVisitedDays > 0 ? now - notVisitedDays * DAY_MS : null
  return (rows || []).filter(function (r) {
    if (q && !((r.name || '').toLowerCase().includes(q) || (r.address || '').toLowerCase().includes(q))) return false
    if (territoryId && r.territory_id !== territoryId) return false
    if (staffId && !(Array.isArray(r.rep_staff_ids) && r.rep_staff_ids.includes(staffId))) return false
    if (cutoff != null && !(Date.parse(r.last_visit_at) < cutoff)) return false
    return true
  })
}

// "today", "yesterday", "N days ago": whole days since the last visit.
export function lastSeenText(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const days = Math.max(0, Math.floor((now - t) / DAY_MS))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return days + ' days ago'
}
