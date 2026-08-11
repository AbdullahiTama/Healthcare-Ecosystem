// ── pagedQuery: fetch every row of a PostgREST collection ────────────────────
// PostgREST clamps every response to `db-max-rows`, which defaults to 1000 on
// this project's Supabase. A request for `?limit=50000` still returns at most
// 1000 rows — proven against the live project (2026-08-11): 12,276 products in
// the table, `Content-Range: 0-999/12276` on a `limit=50000` request. Raising
// the client-side limit was never going to help; the rows past the cap existed
// in the database but were unreachable through a single query.
//
// The only way through the clamp is offset paging: request `limit=1000&offset=N`
// until a page comes back shorter than the page size (that is how the caller
// knows the collection is exhausted — PostgREST returns fewer rows on the last
// page, not an explicit end marker).
//
// Requirements on the callers:
//   - The path must already carry a deterministic total order (`order=...asc`).
//     Offset paging assumes stable ordering between pages; a name-asc order
//     with ties would otherwise be free to shift rows across page boundaries.
//     Prefer `order=<field>.asc,id.asc` — the id tiebreaker pins the order.
//   - `pageSize` must stay at or below the server's db-max-rows (1000 here).
//     Requesting more is pointless: the server clamps to its own ceiling and
//     the loop just wastes a page.
//
// Works through the injected `request` transport (sbFetch in production, the
// in-memory adapter in tests), so it is exercised by the same tests as every
// repository.
export async function pagedQuery(request, path, { pageSize = 1000 } = {}) {
  const sep = path.includes('?') ? '&' : '?'
  let offset = 0
  let all = []
  let pages = 0
  // Safety valve: an offset ignored by the server would otherwise loop
  // forever returning full pages. 1000 pages is a million rows — far beyond
  // any tenant collection, so hitting it means the server is not honouring
  // offset and the caller needs to know rather than hang.
  const MAX_PAGES = 1000
  while (pages < MAX_PAGES) {
    const rows = await request(`${path}${sep}limit=${pageSize}&offset=${offset}`)
    const page = rows || []
    all = all.concat(page)
    if (page.length < pageSize) break
    offset += pageSize
    pages += 1
  }
  if (pages >= MAX_PAGES) {
    throw new Error(`pagedQuery: ${path} kept returning full pages — the server is not honouring offset`)
  }
  return all
}
