// Reads for the pages and sitemaps served to search engines (api/_handlers/seo.js, sitemap.js), as a logged-out
// visitor: the PUBLIC anon key, never the service-role key, so RLS and column grants decide what can be read and
// nothing private can reach a public page by mistake (the same rule as api/_handlers/og.js).
// Never throws: a failed read gives [] / null and is logged, so a crawler still gets a page.

const SUPABASE_URL = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON_KEY = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
export const PAGE_SIZE = 1000   // PostgREST's usual max rows per response

export function publicDataAvailable() {
  return !!(SUPABASE_URL() && ANON_KEY())
}

async function request(table, params, { range } = {}) {
  const url = `${SUPABASE_URL()}/rest/v1/${table}?${new URLSearchParams(params)}`
  const headers = { apikey: ANON_KEY(), Authorization: `Bearer ${ANON_KEY()}`, Accept: 'application/json' }
  if (range) { headers.Range = range; headers['Range-Unit'] = 'items' }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`${table}: HTTP ${res.status} ${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// `optional`: a column a later migration adds (e.g. 'updated_at'); asked for, and when the database does not have it
// yet (HTTP 400), the read is made again without it.
const withOptional = (params, optional) => (optional ? { ...params, select: `${params.select},${optional}` } : params)

// Rows of `table`. `params` are PostgREST query params (select, filters, order, limit).
export async function rows(table, params, { optional } = {}) {
  if (!publicDataAvailable()) return []
  try {
    const out = await request(table, withOptional(params, optional))
    return Array.isArray(out) ? out : []
  } catch (e) {
    if (optional && e.status === 400) return rows(table, params)
    console.error('[public-data] read failed', e.message)
    return []
  }
}

export async function one(table, params, opts) {
  return (await rows(table, { ...params, limit: '1' }, opts))[0] || null
}

// Every row, a page at a time (up to `max`), for the sitemaps.
export async function allRows(table, params, { max = 60000, optional } = {}) {
  if (!publicDataAvailable()) return []
  const out = []
  let p = withOptional(params, optional)
  try {
    for (let from = 0; from < max; from += PAGE_SIZE) {
      let page
      try {
        page = await request(table, p, { range: `${from}-${from + PAGE_SIZE - 1}` })
      } catch (e) {
        if (optional && e.status === 400 && p !== params) { p = params; from -= PAGE_SIZE; continue }
        throw e
      }
      if (!Array.isArray(page) || page.length === 0) break
      out.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  } catch (e) {
    console.error('[public-data] paged read failed', e.message)
  }
  return out
}
