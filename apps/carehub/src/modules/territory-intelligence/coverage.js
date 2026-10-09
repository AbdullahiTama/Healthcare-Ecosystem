// ── Territory Intelligence — pure analytics helpers ───────────────────────────
// The database aggregates (sql/20261011_territory_intelligence.sql); this module
// only shapes the rows for display. No I/O.
//
// "Visited" = a submitted field activity carrying that directory business's id,
// which the Live Field Report sets only when the representative CONFIRMED the
// business. GPS proximity never counts, so coverage is a LOWER bound: visits
// logged without confirming a business are invisible to it. `linkedShare`
// quantifies that blind spot.

export const WINDOWS = [
  { days: 30, label: 'Last 30 days' },
  { days: 60, label: 'Last 60 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 180, label: 'Last 6 months' },
  { days: 365, label: 'Last 12 months' },
]

export const GROUPS = [
  { id: 'territory', label: 'Territory' },
  { id: 'state', label: 'State' },
  { id: 'lga', label: 'LGA' },
  { id: 'category', label: 'Category' },
]

const DAY_MS = 24 * 60 * 60 * 1000

export function sinceFor(days, now = Date.now()) {
  return new Date(now - days * DAY_MS).toISOString()
}

export function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/** Traffic-light tone for a coverage percentage. */
export function coverageTone(p, total = 1) {
  if (!total) return 'gray'
  if (p >= 70) return 'green'
  if (p >= 35) return 'amber'
  return 'red'
}

const NONE_LABEL = {
  territory: 'No territory assigned',
  state: 'No state recorded',
  lga: 'No LGA recorded',
  category: 'Uncategorised',
}

/**
 * RPC rows -> display rows: numbers coerced (bigint arrives as string/number),
 * blank keys labelled, percentage added, weakest coverage first so the
 * managers' attention goes where the gap is. Unlabelled rows sort last.
 */
export function shapeGroups(rows, group) {
  const out = (rows || []).map((r) => {
    const total = Number(r.total) || 0
    const visited = Number(r.visited) || 0
    const none = !r.group_key
    return {
      key: r.group_key || '',
      label: none ? NONE_LABEL[group] || 'Unspecified' : r.group_label,
      none,
      total,
      visited,
      unvisited: Math.max(0, total - visited),
      pct: pct(visited, total),
    }
  })
  return out.sort((a, b) => (a.none - b.none) || (a.pct - b.pct) || (b.total - a.total) || a.label.localeCompare(b.label))
}

/** Roll the group rows up into headline numbers. */
export function totalsOf(groups) {
  const total = groups.reduce((s, g) => s + g.total, 0)
  const visited = groups.reduce((s, g) => s + g.visited, 0)
  return { total, visited, unvisited: total - visited, pct: pct(visited, total) }
}

/**
 * activities_total / activities_linked from directory_visit_totals.
 * `blindSpot` is true when enough activity exists and under half of it
 * confirmed a business — coverage figures are then understated.
 */
export function visitStats(row) {
  const activities = Number(row?.activities_total) || 0
  const linked = Number(row?.activities_linked) || 0
  const businesses = Number(row?.businesses_visited) || 0
  const linkedShare = pct(linked, activities)
  return { activities, linked, unlinked: activities - linked, businesses, linkedShare, blindSpot: activities >= 5 && linkedShare < 50 }
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null
}

/** "Never visited", "Today", "12 days ago". */
export function lastVisitLabel(iso, now = Date.now()) {
  const d = daysSince(iso, now)
  if (d === null) return 'Never visited'
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return d + ' days ago'
}

export function shapeReps(rows) {
  return (rows || []).map((r) => {
    const activities = Number(r.activities) || 0
    const linked = Number(r.linked_activities) || 0
    return {
      staffId: r.staff_id,
      name: r.rep_name || 'Unknown',
      activities,
      linked,
      businesses: Number(r.businesses) || 0,
      linkedShare: pct(linked, activities),
    }
  })
}
