// ── In-memory adapter for repository tests ────────────────────────────────────
// Repositories depend on a single injected transport `request(path, options)`
// with sbFetch's shape: (path, options) => Promise<rows>. Production binds the
// real PostgREST-backed sbFetch; tests bind this in-memory adapter. It is the
// second adapter that makes the transport a real seam — one interface, two
// adapters — and turns each repository's query shape and tenant scoping into
// the test surface.
//
// It understands exactly the PostgREST path shapes the repositories emit:
// `eq.` filters, `in.(...)` id lists, `select`/`order` (ignored for matching),
// and the GET / POST / PATCH / DELETE verbs. It is intentionally NOT a full
// PostgREST — only what the repositories actually use.
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

  const matches = (row, params) => {
    for (const [key, val] of params.entries()) {
      if (key === 'select' || key === 'order') continue
      if (val.startsWith('eq.')) {
        if (String(row[key]) !== val.slice(3)) return false
      } else if (val.startsWith('in.(')) {
        const ids = val.slice(4, -1).split(',')
        if (!ids.includes(String(row[key]))) return false
      }
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
