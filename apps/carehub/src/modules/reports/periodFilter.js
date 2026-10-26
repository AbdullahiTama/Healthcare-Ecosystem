// Whether an item's date falls inside the selected report period.
// Takes its options as one object so it can never be handed to Array.filter
// directly: filter's (item, index, array) arguments would otherwise land in
// the wrong parameters.
export function inPeriod(item, { period, month, now = new Date(), dateOf = i => i.created_at || '' }) {
  const d = dateOf(item) || ''
  if (period === 'today') return d.startsWith(now.toISOString().split('T')[0])
  if (period === 'week') return new Date(d) >= new Date(now - 7 * 864e5)
  if (period === 'month') return d.startsWith(month)
  if (period === 'year') return d.startsWith(String(now.getFullYear()))
  return true
}

// The server-side window for a period, as ISO date-time strings: { from, to }
// with `to` exclusive, or nulls for 'all'. Matches inPeriod (UTC dates) so a
// screen can ask the database for just the period, then filter with inPeriod.
export function periodRange({ period, month, now = new Date() }) {
  const day = (d) => d.toISOString().split('T')[0]
  if (period === 'today') {
    const start = day(now)
    const next = new Date(start + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1)
    return { from: start + 'T00:00:00', to: day(next) + 'T00:00:00' }
  }
  if (period === 'week') return { from: new Date(now - 7 * 864e5).toISOString(), to: null }
  if (period === 'month' && /^\d{4}-\d{2}$/.test(month || '')) {
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return { from: `${month}-01T00:00:00`, to: `${next}-01T00:00:00` }
  }
  if (period === 'year') {
    const y = now.getFullYear()
    return { from: `${y}-01-01T00:00:00`, to: `${y + 1}-01-01T00:00:00` }
  }
  return { from: null, to: null }
}
