// Local updates to the in-memory product list after a save.
//
// The products page used to re-download the whole catalog (twice) after every
// add, edit, delete, restock or import. For a 3,000+ product pharmacy that is
// several large requests plus a multi-megabyte localStorage write per click,
// which froze older devices. The server already returns the row it changed, so
// the page now applies that row to the list it already holds instead.
//
// These helpers are pure: they never mutate the list they are given, so React
// sees a new array and re-renders.

// Same order as productRepository.getAll (name, then id). localeCompare is
// close to, not identical to, Postgres collation; the next full load
// (sign-in or page reload) restores the server's exact order.
function byNameThenId(a, b) {
  const n = String(a.name || '').localeCompare(String(b.name || ''))
  if (n !== 0) return n
  return String(a.id).localeCompare(String(b.id))
}

// PostgREST answers a POST/PATCH with an array of rows; some callers already
// unwrapped it. Accept either and drop anything without an id.
export function toRows(result) {
  const rows = Array.isArray(result) ? result : result ? [result] : []
  return rows.filter((r) => r && r.id !== undefined && r.id !== null)
}

// Replace rows that already exist (merging, so a partial row only changes the
// fields it carries) and insert new ones in name order.
export function upsertProducts(list, result) {
  const rows = toRows(result)
  if (rows.length === 0) return list
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  const next = list.map((p) => {
    const row = byId.get(String(p.id))
    if (!row) return p
    byId.delete(String(p.id))
    return { ...p, ...row }
  })
  if (byId.size === 0) return next
  return [...next, ...byId.values()].sort(byNameThenId)
}

export function removeProducts(list, ids) {
  const gone = new Set((ids || []).map(String))
  if (gone.size === 0) return list
  return list.filter((p) => !gone.has(String(p.id)))
}
