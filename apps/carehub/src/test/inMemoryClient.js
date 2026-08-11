// ── In-memory adapter for repository tests ────────────────────────────────────
// Repositories depend on a single injected transport `request(path, options)`
// with sbFetch's shape: (path, options) => Promise<rows>. Production binds the
// real PostgREST-backed sbFetch; tests bind this in-memory adapter. It is the
// second adapter that makes the transport a real seam — one interface, two
// adapters — and turns each repository's query shape and tenant scoping into
// the test surface.
//
// It understands exactly the PostgREST path shapes the repositories emit:
// `eq.` / `neq.` / `is.null`, the range operators `gte.` `lte.` `gt.` `lt.`,
// `in.(...)` lists, flat `or=(a.eq.1,b.eq.2)`, `select`/`order`/`limit`
// (ignored for matching), and the GET / POST / PATCH / DELETE verbs. It is
// intentionally NOT a full PostgREST — only what the repositories actually use.
//
// Anything else THROWS rather than being ignored. That matters: an earlier
// version silently skipped filters it did not recognise, so a repository query
// could add a tenant filter the adapter dropped on the floor, and the test
// asserting that filter would pass for the wrong reason.
//
// `order` is parsed but not applied: rows come back in insertion order. Tests
// that care which row a repository picks out of several matches should assert
// against the real ordering elsewhere, not rely on this adapter for it.
export function createInMemoryClient(seed = {}) {
  const db = {}
  for (const [table, rows] of Object.entries(seed)) db[table] = rows.map((r) => ({ ...r }))
  let autoId = 1000

  const parse = (path) => {
    const [table, query = ''] = path.split('?')
    return { table, params: new URLSearchParams(query) }
  }

  // One `column=operator.value` condition. Returns null for an operator this
  // adapter does not implement, so the caller can fail loudly rather than
  // silently letting the row through — a filter this fake quietly ignores would
  // make every test using it look stronger than it is.
  // ISO timestamps and dates compare correctly as strings, which is all the
  // repositories use these for (today's sales, expiry cutoffs).
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

  const condition = (row, key, val) => {
    if (val.startsWith('eq.')) return String(row[key]) === val.slice(3)
    if (val.startsWith('neq.')) return String(row[key]) !== val.slice(4)
    if (val.startsWith('is.null')) return row[key] === null || row[key] === undefined
    if (val.startsWith('in.(')) return val.slice(4, -1).split(',').includes(String(row[key]))
    if (val.startsWith('gte.')) return row[key] != null && compare(String(row[key]), val.slice(4)) >= 0
    if (val.startsWith('lte.')) return row[key] != null && compare(String(row[key]), val.slice(4)) <= 0
    if (val.startsWith('gt.')) return row[key] != null && compare(String(row[key]), val.slice(3)) > 0
    if (val.startsWith('lt.')) return row[key] != null && compare(String(row[key]), val.slice(3)) < 0
    return null
  }

  const matches = (row, params) => {
    for (const [key, val] of params.entries()) {
      if (key === 'select' || key === 'order' || key === 'limit') continue

      // `or=(a.eq.1,b.eq.2)` — the flat form the repositories emit. Nested
      // and()/or() is not supported; nothing here produces it.
      if (key === 'or') {
        const inner = val.replace(/^\(/, '').replace(/\)$/, '')
        const any = inner.split(',').some((clause) => {
          const [col, ...rest] = clause.split('.')
          const result = condition(row, col, rest.join('.'))
          if (result === null) throw new Error(`inMemoryClient: unsupported or() clause "${clause}"`)
          return result
        })
        if (!any) return false
        continue
      }

      const result = condition(row, key, val)
      if (result === null) throw new Error(`inMemoryClient: unsupported filter "${key}=${val}"`)
      if (!result) return false
    }
    return true
  }

  const request = async (path, options = {}) => {
    const method = options.method || 'GET'
    const { table, params } = parse(path)
    db[table] = db[table] || []
    if (method === 'GET') return db[table].filter((r) => matches(r, params)).map((r) => ({ ...r }))
    if (method === 'POST') {
      const body = JSON.parse(options.body)
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: r.id ?? ++autoId, ...r }))
      db[table].push(...rows.map((r) => ({ ...r })))
      return rows
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(options.body)
      const affected = db[table].filter((r) => matches(r, params))
      affected.forEach((r) => Object.assign(r, patch))
      return options.prefer === 'return=minimal' ? [] : affected.map((r) => ({ ...r }))
    }
    if (method === 'DELETE') {
      db[table] = db[table].filter((r) => !matches(r, params))
      return []
    }
    throw new Error('unsupported method ' + method)
  }

  // Inspection helper for assertions — returns a copy of a table's rows.
  request.rows = (table) => (db[table] || []).map((r) => ({ ...r }))
  return request
}
