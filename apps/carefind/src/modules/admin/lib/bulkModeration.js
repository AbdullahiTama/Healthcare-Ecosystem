// A Moderation item for a reported post is keyed by the POST id (several
// reports on one post collapse into one item), but resolve_report takes a
// REPORT id. Resolve every pending report on the post, by its own id.
export function reportsToResolve(item, reports = []) {
  if (!item.target_id) return item.raw?.status === 'pending' ? [item.raw] : []
  return reports.filter(r => r.post_id === item.target_id && r.status === 'pending')
}
