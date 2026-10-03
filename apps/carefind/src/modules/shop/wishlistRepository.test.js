// The wishlist lives in localStorage (instant) and is mirrored to shop_wishlist for signed-in users. The mirror
// must be safe under rapid toggling: per-item writes, applied in order, never "delete everything then re-insert".
vi.mock('../../config/supabaseClient', () => ({ supabase: {} }))
import { createWishlistRepository } from './wishlistRepository'

// A fake supabase client that records every wishlist operation. Each operation takes `delay` ms, so concurrent
// writes overlap exactly as they do against the network.
function fakeClient({ user = { id: 'u1' }, rows = [], delay = 5, failUpsert = false } = {}) {
  const log = []
  const client = {
    log,
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      const q = { table, filters: {} }
      const run = () => {
        log.push(['start', q.op, { ...q.filters }, q.row])
        return new Promise((resolve) => setTimeout(() => {
          log.push(['end', q.op, { ...q.filters }, q.row])
          if (q.op === 'select') return resolve({ data: rows.map((id) => ({ ecommerce_product_id: id })), error: null })
          if (q.op === 'upsert' && failUpsert) return resolve({ data: null, error: { message: 'write failed' } })
          resolve({ data: null, error: null })
        }, delay))
      }
      const b = {
        upsert: (row, opts) => { q.op = 'upsert'; q.row = row; q.opts = opts; return run() },
        delete: () => { q.op = 'delete'; return b },
        select: () => { q.op = 'select'; return b },
        eq: (c, v) => { q.filters[c] = v; return b },
        then: (res, rej) => run().then(res, rej),
      }
      return b
    },
  }
  return client
}

const ops = (client, kind) => client.log.filter(([phase, op]) => phase === 'start' && op === kind)

describe('wishlistRepository', () => {
  beforeEach(() => localStorage.clear())

  it('updates the local wishlist immediately', () => {
    const repo = createWishlistRepository(fakeClient())

    expect(repo.toggle('a')).toEqual(['a'])
    expect(repo.toggle('b')).toEqual(['a', 'b'])
    expect(repo.getAll()).toEqual(['a', 'b'])
  })

  it('syncs an added product as one upsert of that product, never a delete of the whole wishlist', async () => {
    const client = fakeClient()
    const repo = createWishlistRepository(client)

    repo.toggle('a')
    await repo.flush()

    expect(ops(client, 'delete')).toHaveLength(0)
    expect(ops(client, 'upsert')).toHaveLength(1)
    const [, , , row] = ops(client, 'upsert')[0]
    expect(row).toEqual({ user_id: 'u1', ecommerce_product_id: 'a' })
  })

  it('syncs a removed product as a delete scoped to that user and product', async () => {
    const client = fakeClient()
    const repo = createWishlistRepository(client)
    repo.toggle('a')
    await repo.flush()
    client.log.length = 0

    repo.toggle('a')
    await repo.flush()

    expect(ops(client, 'delete')).toEqual([['start', 'delete', { user_id: 'u1', ecommerce_product_id: 'a' }, undefined]])
  })

  it('applies rapid toggles one at a time and in order', async () => {
    const client = fakeClient({ delay: 8 })
    const repo = createWishlistRepository(client)

    repo.toggle('a'); repo.toggle('b'); repo.toggle('a')
    await repo.flush()

    const sequence = client.log.map(([phase, op, filters, row]) => `${phase}:${op}:${row?.ecommerce_product_id ?? filters.ecommerce_product_id}`)
    expect(sequence).toEqual([
      'start:upsert:a', 'end:upsert:a',
      'start:upsert:b', 'end:upsert:b',
      'start:delete:a', 'end:delete:a',
    ])
  })

  it('does not touch the database for a signed-out visitor', async () => {
    const client = fakeClient({ user: null })
    const repo = createWishlistRepository(client)

    repo.toggle('a')
    await repo.flush()

    expect(client.log).toEqual([])
    expect(repo.getAll()).toEqual(['a'])
  })

  it('keeps the local change and reports it when a write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = createWishlistRepository(fakeClient({ failUpsert: true }))

    repo.toggle('a')
    await expect(repo.flush()).resolves.toBeUndefined()

    expect(repo.getAll()).toEqual(['a'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('reads from the database only after pending writes have landed', async () => {
    const client = fakeClient({ rows: ['a'], delay: 8 })
    const repo = createWishlistRepository(client)

    repo.toggle('a')
    const loaded = await repo.getAllAsync()

    const selectStart = client.log.findIndex(([phase, op]) => phase === 'start' && op === 'select')
    const upsertEnd = client.log.findIndex(([phase, op]) => phase === 'end' && op === 'upsert')
    expect(upsertEnd).toBeGreaterThanOrEqual(0)
    expect(upsertEnd).toBeLessThan(selectStart)
    expect(loaded).toEqual(['a'])
  })

  it('clear removes the whole wishlist with a single scoped delete', async () => {
    const client = fakeClient()
    const repo = createWishlistRepository(client)
    repo.toggle('a'); repo.toggle('b')
    await repo.flush()
    client.log.length = 0

    expect(repo.clear()).toEqual([])
    await repo.flush()

    expect(ops(client, 'delete')).toEqual([['start', 'delete', { user_id: 'u1' }, undefined]])
  })
})
