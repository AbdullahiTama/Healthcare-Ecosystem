import { describe, it, expect, vi } from 'vitest'
import { loadProductCatalog, catalogCacheKey } from './productCatalog.js'

const B = 'biz-1'
const server = [{ id: 'a', name: 'Amoxil' }, { id: 'b', name: 'Panadol' }]
const copy = [{ id: 'old', name: 'Saved product' }]

const cacheWith = (rows) => vi.fn((key) => (key === catalogCacheKey(B) ? rows : null))

describe('loadProductCatalog', () => {
  it('returns the server rows and does not read the saved copy on success', async () => {
    const readCache = cacheWith(copy)
    const r = await loadProductCatalog({ businessId: B, fetchAll: async () => server, readCache })
    expect(r).toEqual({ products: server, source: 'server', stale: false, reason: null, error: null })
    expect(readCache).not.toHaveBeenCalled()
  })

  it('forwards page progress to the caller', async () => {
    const seen = []
    const fetchAll = async (_id, { onProgress }) => { onProgress(1000); onProgress(1500); return server }
    await loadProductCatalog({ businessId: B, fetchAll, readCache: cacheWith(null), onProgress: (n) => seen.push(n) })
    expect(seen).toEqual([1000, 1500])
  })

  it('offline: shows the saved copy without calling the server', async () => {
    const fetchAll = vi.fn()
    const r = await loadProductCatalog({ businessId: B, fetchAll, readCache: cacheWith(copy), online: false })
    expect(fetchAll).not.toHaveBeenCalled()
    expect(r).toMatchObject({ products: copy, source: 'cache', stale: true, reason: 'offline', error: null })
  })

  it('offline with no saved copy: reports an error, nothing to show', async () => {
    const r = await loadProductCatalog({ businessId: B, fetchAll: vi.fn(), readCache: cacheWith(null), online: false })
    expect(r.source).toBe('none')
    expect(r.error.message).toMatch(/offline/)
  })

  it('a failed request falls back to the saved copy and keeps the error', async () => {
    const boom = new Error('Supabase error (500)')
    const r = await loadProductCatalog({ businessId: B, fetchAll: async () => { throw boom }, readCache: cacheWith(copy) })
    expect(r).toMatchObject({ products: copy, source: 'cache', stale: true, reason: 'failed', error: boom })
  })

  it('a failed request with no saved copy has nothing to show', async () => {
    const boom = new Error('network')
    const r = await loadProductCatalog({ businessId: B, fetchAll: async () => { throw boom }, readCache: cacheWith(null) })
    expect(r).toMatchObject({ products: [], source: 'none', error: boom })
  })

  it('an empty answer while a saved copy exists is unconfirmed (expired sign-in), so the copy is shown', async () => {
    const r = await loadProductCatalog({ businessId: B, fetchAll: async () => [], readCache: cacheWith(copy) })
    expect(r).toMatchObject({ products: copy, source: 'cache', stale: true, reason: 'unconfirmed' })
  })

  it('an empty answer with no saved copy means the business has no products yet', async () => {
    const r = await loadProductCatalog({ businessId: B, fetchAll: async () => [], readCache: cacheWith([]) })
    expect(r).toEqual({ products: [], source: 'server', stale: false, reason: null, error: null })
  })

  it('a broken saved copy is ignored rather than crashing the load', async () => {
    const readCache = () => { throw new Error('SecurityError: storage disabled') }
    const r = await loadProductCatalog({ businessId: B, fetchAll: async () => { throw new Error('x') }, readCache })
    expect(r.source).toBe('none')
  })
})
