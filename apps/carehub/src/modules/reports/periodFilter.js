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
