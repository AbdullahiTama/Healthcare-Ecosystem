import { describe, it, expect } from 'vitest'
import { createProductRepository, productRepository } from './index.js'

// ── In-memory adapter ────────────────────────────────────────────────────────
// The repository's only outside dependency is a `request(path, options)`
// function with sbFetch's shape. In production that transport is bound to the
// real PostgREST-backed sbFetch; here it is bound to this in-memory adapter —
// the second adapter that makes the seam real and turns the repository's query
// shape and tenant scoping into the test surface.
//
// It understands exactly the PostgREST path shapes the product repository
// emits: `eq.` filters, `in.(...)` id lists, `select`/`order` (ignored), and
// the GET/POST/PATCH/DELETE verbs.
function createInMemoryClient(seed = {}) {
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
  request.rows = (table) => (db[table] || []).map((r) => ({ ...r }))
  return request
}

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    products: [
      { id: '1', business_id: A, name: 'Paracetamol', stock: 10 },
      { id: '2', business_id: A, name: 'Amoxicillin', stock: 4 },
      { id: '3', business_id: A, name: 'Ibuprofen', stock: 0 },
      { id: '9', business_id: B, name: 'Other-biz product', stock: 7 },
    ],
  })
  return { client, repo: createProductRepository(client) }
}

describe('productRepository', () => {
  it('getAll returns only the calling business tenant, ordered query aside', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2', '3'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('getById scopes by id AND business, returning null when absent', async () => {
    const { repo } = seeded()
    expect((await repo.getById('1', A)).name).toBe('Paracetamol')
    // product 9 belongs to B — must not leak to A
    expect(await repo.getById('9', A)).toBeNull()
    expect(await repo.getById('does-not-exist', A)).toBeNull()
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { name: 'Vitamin C', stock: 20 })
    const created = client.rows('products').find((r) => r.name === 'Vitamin C')
    expect(created.business_id).toBe(A)
  })

  it('update scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.update('1', A, { stock: 99 })
    expect(client.rows('products').find((r) => r.id === '1').stock).toBe(99)
    // cannot update another business's row through A's scope
    await repo.update('9', A, { stock: 0 })
    expect(client.rows('products').find((r) => r.id === '9').stock).toBe(7)
  })

  it('delete scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.delete('2', A)
    expect(client.rows('products').map((r) => r.id)).not.toContain('2')
    // A cannot delete B's row
    await repo.delete('9', A)
    expect(client.rows('products').map((r) => r.id)).toContain('9')
  })

  // ── Bug 1: deleteBulk was called by the cleanup flow but never defined ──────
  it('deleteBulk removes exactly the given ids for the tenant', async () => {
    const { repo, client } = seeded()
    await repo.deleteBulk(['1', '3'], A)
    expect(client.rows('products').map((r) => r.id).sort()).toEqual(['2', '9'])
  })

  it('deleteBulk never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    // id '9' belongs to B; passing it under A's scope must not delete it
    await repo.deleteBulk(['1', '9'], A)
    expect(client.rows('products').map((r) => r.id).sort()).toEqual(['2', '3', '9'])
  })

  it('deleteBulk is a no-op on an empty list (issues no request)', async () => {
    let called = false
    const repo = createProductRepository(async () => {
      called = true
      return []
    })
    await repo.deleteBulk([], A)
    expect(called).toBe(false)
  })

  // ── Bug 2: updateStock was dead and malformed (unscoped PATCH with a
  // non-PostgREST { increment } body). It is removed; stock changes go through
  // update() with a read-modify-written value. Guard against reintroduction.
  it('does not expose the malformed updateStock', () => {
    const { repo } = seeded()
    expect(repo.updateStock).toBeUndefined()
  })

  it('exports a default productRepository instance', () => {
    expect(typeof productRepository.getAll).toBe('function')
    expect(typeof productRepository.deleteBulk).toBe('function')
  })
})
