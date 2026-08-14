import { describe, it, expect } from 'vitest'
import { createSaleRepository, createMemoryOfflineQueue, isServerRejection } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

// Builds a repository wired to in-memory adapters for all three collaborators,
// so both branches of create() and the whole sync path are reachable without a
// network, a browser or localStorage.
function build({ seed = {}, online = true, queued = [] } = {}) {
  const client = createInMemoryClient(seed)
  const offline = createMemoryOfflineQueue(queued)
  const repo = createSaleRepository({ request: client, offline, isOnline: () => online })
  return { client, offline, repo }
}

describe('saleRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = build({
      seed: {
        sales: [
          { id: 's1', business_id: A, txn_no: 'TXN-1' },
          { id: 's9', business_id: B, txn_no: 'TXN-9' },
        ],
      },
    })
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.txn_no)).toEqual(['TXN-1'])
  })

  it('getAll applies the hold and credit filters', async () => {
    const { repo } = build({
      seed: {
        sales: [
          { id: 's1', business_id: A, is_on_hold: true, is_credit: false },
          { id: 's2', business_id: A, is_on_hold: false, is_credit: true },
        ],
      },
    })
    expect((await repo.getAll(A, { onHold: true })).map((r) => r.id)).toEqual(['s1'])
    expect((await repo.getAll(A, { isCredit: true })).map((r) => r.id)).toEqual(['s2'])
  })

  it('getToday excludes held sales and other tenants', async () => {
    const today = new Date().toISOString().split('T')[0]
    const { repo } = build({
      seed: {
        sales: [
          { id: 'done', business_id: A, is_on_hold: false, created_at: `${today}T09:00:00` },
          { id: 'held', business_id: A, is_on_hold: true, created_at: `${today}T09:00:00` },
          { id: 'other', business_id: B, is_on_hold: false, created_at: `${today}T09:00:00` },
        ],
      },
    })
    expect((await repo.getToday(A)).map((r) => r.id)).toEqual(['done'])
  })

  it('create writes through and stamps the tenant when online', async () => {
    const { repo, client, offline } = build()
    const result = await repo.create(A, { txn_no: 'TXN-1', total: 500 })

    expect(result.queued).toBe(false)
    expect(client.rows('sales')[0]).toMatchObject({ txn_no: 'TXN-1', business_id: A })
    expect(offline.all()).toHaveLength(0)
  })

  it('create queues the sale when offline, and writes nothing', async () => {
    const { repo, client, offline } = build({ online: false })
    const result = await repo.create(A, { txn_no: 'TXN-1', total: 500 })

    expect(result).toMatchObject({ queued: true, reason: 'offline' })
    expect(client.rows('sales')).toHaveLength(0)
    expect(offline.all()[0]).toMatchObject({ txn_no: 'TXN-1', business_id: A })
  })

  // Money that already changed hands must never be dropped because a write failed.
  it('create queues the sale when the write throws', async () => {
    const offline = createMemoryOfflineQueue()
    const repo = createSaleRepository({
      request: async () => { throw new Error('network down') },
      offline,
      isOnline: () => true,
    })
    const result = await repo.create(A, { txn_no: 'TXN-1', total: 500 })

    expect(result).toMatchObject({ queued: true, reason: 'error' })
    expect(offline.all()[0]).toMatchObject({ txn_no: 'TXN-1' })
  })

  // The server refused this sale (e.g. guard_sale_item_prices rejected an
  // unauthorized price override): parking it would retry forever, so it is
  // rethrown for the cashier to see instead of queued.
  it('create rethrows a server rejection instead of queueing the sale', async () => {
    const offline = createMemoryOfflineQueue()
    const repo = createSaleRepository({
      request: async () => { throw new Error('Supabase error (403): Price override not allowed: "Drug A" is priced at 500 but was recorded at 50.') },
      offline,
      isOnline: () => true,
    })

    await expect(repo.create(A, { txn_no: 'TXN-1', total: 500 })).rejects.toThrow(/Price override not allowed/)
    expect(offline.all()).toHaveLength(0)
  })

  it('isServerRejection only matches client-side HTTP rejections', () => {
    expect(isServerRejection(new Error('Supabase error (403): denied'))).toBe(true)
    expect(isServerRejection(new Error('Supabase error (400): bad payload'))).toBe(true)
    expect(isServerRejection(new Error('Supabase error (500): server hiccup'))).toBe(false)
    expect(isServerRejection(new Error('network down'))).toBe(false)
  })

  it('update is scoped to the tenant', async () => {
    const { repo, client } = build({
      seed: {
        sales: [
          { id: 's1', business_id: A, is_on_hold: true },
          { id: 's9', business_id: B, is_on_hold: true },
        ],
      },
    })
    await repo.update('s1', A, { is_on_hold: false, status: 'deleted' })
    await repo.update('s9', A, { is_on_hold: false, status: 'deleted' }) // wrong tenant

    const byId = Object.fromEntries(client.rows('sales').map((s) => [s.id, s]))
    expect(byId['s1']).toMatchObject({ is_on_hold: false, status: 'deleted' })
    expect(byId['s9'].is_on_hold).toBe(true) // untouched
  })

  it('syncQueued replays every queued sale and empties the queue', async () => {
    const { repo, client, offline } = build({
      queued: [{ txn_no: 'TXN-1', total: 100 }, { txn_no: 'TXN-2', total: 200 }],
    })
    const result = await repo.syncQueued(A)

    expect(result.synced).toBe(2)
    expect(result.rejected).toHaveLength(0)
    expect(client.rows('sales').map((s) => s.txn_no).sort()).toEqual(['TXN-1', 'TXN-2'])
    // the internal queue id is stripped before the row is written
    expect(client.rows('sales').every((s) => s._offline_id === undefined)).toBe(true)
    expect(client.rows('sales').every((s) => s.business_id === A)).toBe(true)
    expect(offline.all()).toHaveLength(0)
  })

  // A partial sync used to clear the whole queue as long as one sale landed,
  // destroying the sales that never reached the database — real money, gone.
  it('syncQueued keeps the sales that failed and drops only the ones that landed', async () => {
    const offline = createMemoryOfflineQueue([
      { txn_no: 'TXN-ok-1', total: 100 },
      { txn_no: 'TXN-bad', total: 200 },
      { txn_no: 'TXN-ok-2', total: 300 },
    ])
    const written = []
    const repo = createSaleRepository({
      request: async (path, options) => {
        const row = JSON.parse(options.body)
        if (row.txn_no === 'TXN-bad') throw new Error('rejected by server')
        written.push(row)
        return [row]
      },
      offline,
      isOnline: () => true,
    })

    const result = await repo.syncQueued(A)

    expect(result.synced).toBe(2)
    expect(written.map((r) => r.txn_no)).toEqual(['TXN-ok-1', 'TXN-ok-2'])
    // the rejected sale is still queued, and will be retried
    expect(offline.all().map((s) => s.txn_no)).toEqual(['TXN-bad'])
  })

  // A server-refused sale (4xx) is permanent: it is reported to the caller
  // and kept in the queue (never dropped), so it can be resolved rather than
  // silently retried forever.
  it('syncQueued reports a server-refused sale and keeps it queued', async () => {
    const offline = createMemoryOfflineQueue([
      { txn_no: 'TXN-ok', total: 100 },
      { txn_no: 'TXN-blocked', total: 200 },
    ])
    const written = []
    const repo = createSaleRepository({
      request: async (path, options) => {
        const row = JSON.parse(options.body)
        if (row.txn_no === 'TXN-blocked') throw new Error('Supabase error (403): Price override not allowed: "Drug A" is priced at 500 but was recorded at 50.')
        written.push(row)
        return [row]
      },
      offline,
      isOnline: () => true,
    })

    const result = await repo.syncQueued(A)

    expect(result.synced).toBe(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].txn_no).toBe('TXN-blocked')
    expect(result.rejected[0].error).toMatch(/Price override not allowed/)
    // the blocked sale is never dropped — it stays queued for the cashier
    expect(offline.all().map((s) => s.txn_no)).toEqual(['TXN-blocked'])
    expect(written.map((r) => r.txn_no)).toEqual(['TXN-ok'])
  })

  it('syncQueued leaves the queue intact when every sale fails', async () => {
    const offline = createMemoryOfflineQueue([{ txn_no: 'TXN-1' }, { txn_no: 'TXN-2' }])
    const repo = createSaleRepository({
      request: async () => { throw new Error('server down') },
      offline,
      isOnline: () => true,
    })
    const result = await repo.syncQueued(A)
    expect(result.synced).toBe(0)
    expect(offline.all()).toHaveLength(2)
  })

  it('syncQueued is a no-op while offline, so the queue survives', async () => {
    const { repo, client, offline } = build({ online: false, queued: [{ txn_no: 'TXN-1' }] })
    const result = await repo.syncQueued(A)
    expect(result.synced).toBe(0)
    expect(client.rows('sales')).toHaveLength(0)
    expect(offline.all()).toHaveLength(1)
  })
})
