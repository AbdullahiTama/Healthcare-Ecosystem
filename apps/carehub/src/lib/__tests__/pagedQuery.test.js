import { describe, it, expect } from 'vitest'
import { pagedQuery } from '../pagedQuery.js'

describe('pagedQuery', () => {
  // A fake transport that honours limit/offset the way PostgREST does — and
  // clamps every page at the server's db-max-rows ceiling (1000), exactly the
  // live behaviour this helper exists to work around.
  function pagedTransport(rows, { maxRows = 1000 } = {}) {
    const calls = []
    const request = async (path) => {
      calls.push(path)
      const params = new URLSearchParams(path.split('?')[1])
      const limit = Math.min(parseInt(params.get('limit'), 10), maxRows)
      const offset = parseInt(params.get('offset'), 10) || 0
      return rows.slice(offset, offset + limit)
    }
    return { request, calls }
  }

  it('returns every row by paging until the last short page', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
    const { request, calls } = pagedTransport(rows)
    const all = await pagedQuery(request, 'products?select=*')
    expect(all).toHaveLength(2500)
    expect(calls.map((c) => c.split('?')[1])).toEqual([
      'select=*&limit=1000&offset=0',
      'select=*&limit=1000&offset=1000',
      'select=*&limit=1000&offset=2000',
    ])
  })

  it('issues a single request when the collection fits on one page', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i }))
    const { request, calls } = pagedTransport(rows)
    const all = await pagedQuery(request, 'products?select=*')
    expect(all).toHaveLength(500)
    expect(calls).toHaveLength(1)
  })

  it('returns nothing for an empty collection', async () => {
    const { request, calls } = pagedTransport([])
    expect(await pagedQuery(request, 'products?select=*')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('throws when the server ignores offset and keeps returning full pages', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
    const request = async () => rows // offset ignored — every page is full
    await expect(pagedQuery(request, 'products?select=*')).rejects.toThrow(/not honouring offset/)
  })
})
