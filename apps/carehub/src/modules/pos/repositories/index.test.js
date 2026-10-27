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

describe('saleRepository targeted reads (no whole-history downloads)', () => {
  const seed = {
    sales: [
      { id: 'h1', business_id: A, is_on_hold: true, is_credit: false, balance: 0, created_at: '2026-10-20T10:00:00' },
      { id: 'c1', business_id: A, is_on_hold: false, is_credit: true, balance: 500, created_at: '2026-10-22T10:00:00' },
      { id: 'c0', business_id: A, is_on_hold: false, is_credit: true, balance: 0, created_at: '2026-10-23T10:00:00' },
      { id: 'hc', business_id: A, is_on_hold: true, is_credit: true, balance: 100, created_at: '2026-10-24T10:00:00' },
      { id: 'p1', business_id: A, is_on_hold: false, is_credit: false, balance: 0, created_at: '2026-10-25T10:00:00' },
      { id: 'x9', business_id: B, is_on_hold: true, is_credit: true, balance: 900, created_at: '2026-10-25T11:00:00' },
    ],
  }

  it('getOpen returns held sales and credit sales with a balance, once each, newest first, own tenant only', async () => {
    const { repo } = build({ seed })
    const rows = await repo.getOpen(A)
    expect(rows.map((r) => r.id)).toEqual(['hc', 'c1', 'h1'])
  })

  it('getOpen pages past the 1000-row server cap', async () => {
    const many = Array.from({ length: 1205 }, (_, i) => ({ id: 'h' + i, business_id: A, is_on_hold: true, created_at: '2026-01-01T00:00:00' }))
    const { repo } = build({ seed: { sales: many } })
    expect(await repo.getOpen(A)).toHaveLength(1205)
  })

  it('getSince restricts to [from, to) and pages', async () => {
    const { repo } = build({ seed })
    const rows = await repo.getSince(A, '2026-10-22T00:00:00', { to: '2026-10-25T00:00:00' })
    expect(rows.map((r) => r.id).sort()).toEqual(['c0', 'c1', 'hc'])
    expect((await repo.getSince(A, null)).length).toBe(5)
  })

  it('getRecent returns only completed sales, limited', async () => {
    const { repo } = build({ seed })
    const rows = await repo.getRecent(A, 2)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.is_on_hold === false)).toBe(true)
  })

  it('count asks the database for a count, without rows', async () => {
    const calls = []
    const repo = createSaleRepository({ request: async () => [], requestWithCount: async (path, opts) => { calls.push([path, opts]); return { total: 4321 } } })
    expect(await repo.count(A)).toBe(4321)
    expect(calls).toEqual([[`sales?business_id=eq.${A}&is_on_hold=eq.false&or=(status.is.null,status.eq.completed)&select=id`, { head: true }]])
  })
})

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

  // The printed QR encodes txn_no, and the lookup must stay tenant-scoped: the
  // same txn_no in another business must never resolve here.
  it('getById looks up by txn_no and stays tenant-scoped', async () => {
    const { repo } = build({
      seed: {
        sales: [
          { id: 's1', business_id: A, txn_no: 'TXN-1' },
          { id: 's9', business_id: B, txn_no: 'TXN-1' },
        ],
      },
    })
    expect((await repo.getById(A, 'TXN-1')).id).toBe('s1')
    expect(await repo.getById(A, 'TXN-404')).toBeUndefined()
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

  // ── Fail-loud dispensing (Unit 1) ─────────────────────────────────────────
  // Dispensing is not a till: medication is handed over once, in the real
  // world, so an unsent dispense must NEVER park on the offline queue where it
  // could replay twice — or never land. `{ queueOffline: false }` makes create
  // throw instead, and the queue must be provably untouched.

  it('create with queueOffline:false throws when offline and never queues', async () => {
    const { repo, client, offline } = build({ online: false })
    await expect(
      repo.create(A, { txn_no: 'TXN-D1', dispense_ref: 'DISP-1', total: 500 }, { queueOffline: false })
    ).rejects.toThrow(/Dispensing requires a connection/)
    expect(client.rows('sales')).toHaveLength(0)
    expect(offline.all()).toHaveLength(0)
  })

  it('create with queueOffline:false throws on a transient failure and never queues', async () => {
    const offline = createMemoryOfflineQueue()
    const repo = createSaleRepository({
      request: async () => { throw new Error('network down') },
      offline,
      isOnline: () => true,
    })
    await expect(
      repo.create(A, { txn_no: 'TXN-D2', dispense_ref: 'DISP-2', total: 500 }, { queueOffline: false })
    ).rejects.toThrow('network down')
    expect(offline.all()).toHaveLength(0)
  })

  it('create with queueOffline:false still rethrows a server rejection', async () => {
    const offline = createMemoryOfflineQueue()
    const repo = createSaleRepository({
      request: async () => { throw new Error('Supabase error (403): Price override not allowed: "Drug A" is priced at 500 but was recorded at 50.') },
      offline,
      isOnline: () => true,
    })
    await expect(
      repo.create(A, { txn_no: 'TXN-D3', dispense_ref: 'DISP-3', total: 500 }, { queueOffline: false })
    ).rejects.toThrow(/Price override not allowed/)
    expect(offline.all()).toHaveLength(0)
  })

  // A retry after an ambiguous network drop can hit a dispense_ref that already
  // landed. That is success-with-existing, not a fresh error: the existing sale
  // is returned (replayed) and nothing is written a second time — so the
  // medication is never dispensed twice and stock is never double-decremented.
  it('create replays a dispense_ref duplicate as success-with-existing', async () => {
    const offline = createMemoryOfflineQueue()
    let posts = 0
    const repo = createSaleRepository({
      request: async (path, options) => {
        if (path === 'sales' && options?.method === 'POST') {
          posts++
          if (posts === 1) return [{ id: 's-disp-1', dispense_ref: 'DISP-9', business_id: A }]
          throw new Error('Supabase error (409): duplicate key value violates unique constraint "sales_dispense_ref_uniq"')
        }
        // the follow-up read that resolves the ambiguity
        return [{ id: 's-disp-1', dispense_ref: 'DISP-9', business_id: A, total: 500 }]
      },
      offline,
      isOnline: () => true,
    })

    const first = await repo.create(A, { txn_no: 'TXN-A', dispense_ref: 'DISP-9', total: 500 }, { queueOffline: false })
    const retry = await repo.create(A, { txn_no: 'TXN-A', dispense_ref: 'DISP-9', total: 500 }, { queueOffline: false })

    expect(first).toMatchObject({ queued: false, sale: { id: 's-disp-1' } })
    expect(retry).toMatchObject({ queued: false, replayed: true, sale: { id: 's-disp-1', total: 500 } })
    expect(posts).toBe(2) // exactly one real write attempt for both calls
    expect(offline.all()).toHaveLength(0)
  })

  // A duplicate dispense_ref whose existing row cannot be found (a race between
  // the 409 and the read) must not be silently swallowed into a fake success —
  // it falls through and surfaces as the server rejection it is.
  it('create does not swallow a dispense_ref duplicate it cannot resolve', async () => {
    const offline = createMemoryOfflineQueue()
    const repo = createSaleRepository({
      request: async (path, options) => {
        if (path === 'sales' && options?.method === 'POST') {
          throw new Error('Supabase error (409): duplicate key value violates unique constraint "sales_dispense_ref_uniq"')
        }
        return []
      },
      offline,
      isOnline: () => true,
    })
    await expect(
      repo.create(A, { txn_no: 'TXN-B', dispense_ref: 'DISP-8', total: 500 }, { queueOffline: false })
    ).rejects.toThrow(/duplicate key value violates unique constraint/)
  })

  // The till default is unchanged — with no options, create still queues when
  // offline (already covered above), and a till sale without dispense_ref never
  // triggers the idempotent-replay branch.
  it('create without options still queues for a till when offline', async () => {
    const { repo, client, offline } = build({ online: false })
    const result = await repo.create(A, { txn_no: 'TXN-TILL', total: 500 })

    expect(result).toMatchObject({ queued: true, reason: 'offline' })
    expect(client.rows('sales')).toHaveLength(0)
    expect(offline.all()[0]).toMatchObject({ txn_no: 'TXN-TILL' })
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

  // Sales queued offline at one location must land at that location, even when the owner has switched (or a reload
  // moved them) to another location before the connection came back. The queue is one list per device.
  it('syncQueued posts each queued sale under the location it was rung up at, not the current one', async () => {
    const { repo, client } = build({
      queued: [{ txn_no: 'TXN-A', total: 100, business_id: A }, { txn_no: 'TXN-B', total: 200, business_id: B }],
    })
    const result = await repo.syncQueued(B)
    expect(result.synced).toBe(2)
    const byTxn = Object.fromEntries(client.rows('sales').map((s) => [s.txn_no, s.business_id]))
    expect(byTxn).toEqual({ 'TXN-A': A, 'TXN-B': B })
  })

  it('syncQueued posts a legacy queued sale without a location under the current location, as before', async () => {
    const { repo, client } = build({ queued: [{ txn_no: 'TXN-old', total: 50 }] })
    await repo.syncQueued(A)
    expect(client.rows('sales')[0].business_id).toBe(A)
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

// ── Held sales never count as sales; corrections are owner RPCs ───────────────
describe('saleRepository: held, deleted and resumed rows are not sales', () => {
  const today = new Date().toISOString().split('T')[0]
  const at = `${today}T09:00:00`
  const seed = {
    sales: [
      { id: 'done', business_id: A, is_on_hold: false, status: null, created_at: at },
      { id: 'done2', business_id: A, is_on_hold: false, status: 'completed', created_at: at },
      { id: 'deleted', business_id: A, is_on_hold: false, status: 'deleted', created_at: at },
      { id: 'resumed', business_id: A, is_on_hold: false, status: 'resumed', created_at: at },
      { id: 'held', business_id: A, is_on_hold: true, status: null, created_at: at },
      { id: 'converted', business_id: A, is_on_hold: true, status: 'converted', created_at: at },
      { id: 'credit-deleted', business_id: A, is_on_hold: false, status: 'deleted', is_credit: true, balance: 90, created_at: at },
      { id: 'credit-live', business_id: A, is_on_hold: false, status: null, is_credit: true, balance: 50, created_at: at },
    ],
  }

  it('getToday and getRecent count only completed sales (the dashboard leak)', async () => {
    const { repo } = build({ seed })
    const ids = (rows) => rows.map((r) => r.id).sort()
    expect(ids(await repo.getToday(A))).toEqual(['credit-live', 'done', 'done2'])
    expect(ids(await repo.getRecent(A, 50))).toEqual(['credit-live', 'done', 'done2'])
  })

  it('getOpen lists live holds and live credit sales, never a converted hold or a deleted credit sale', async () => {
    const { repo } = build({ seed })
    expect((await repo.getOpen(A)).map((r) => r.id).sort()).toEqual(['credit-live', 'held'])
  })

  it('updateHeld patches only a row that is still on hold, keeping the app\'s encoded items', async () => {
    const calls = []
    const repo = createSaleRepository({ request: async (path, opts) => { calls.push([path, opts]); return [] }, isOnline: () => true })
    await repo.updateHeld('h1', A, { items: [{ id: 'p', qty: 2 }], subtotal: 10, discount: 0, total: 10, clientName: 'Ada', notes: 'n' })
    const [path, opts] = calls[0]
    expect(path).toBe(`sales?id=eq.h1&business_id=eq.${A}&is_on_hold=eq.true`)
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body)
    expect(JSON.parse(body.items)).toEqual([{ id: 'p', qty: 2 }])
    expect(body).toMatchObject({ total: 10, balance: 10, client_name: 'Ada', notes: 'n' })
    expect(body).not.toHaveProperty('is_on_hold')
    expect(body).not.toHaveProperty('status')
  })

  it('correct, remove and history call the owner-only database functions and the audit trail', async () => {
    const calls = []
    const repo = createSaleRepository({ request: async (path, opts) => { calls.push([path, opts && JSON.parse(opts.body)]); return [] }, isOnline: () => true })
    await repo.correct('s1', { items: [{ id: 'p', qty: 1, price: 5 }], discount: 0, clientId: 'c1', clientName: 'Ada', reason: 'typo' })
    await repo.remove('s1', 'duplicate')
    await repo.history(A, 's1')
    expect(calls[0]).toEqual(['rpc/edit_sale', { p_sale_id: 's1', p_items: [{ id: 'p', qty: 1, price: 5 }], p_discount: 0, p_client_id: 'c1', p_client_name: 'Ada', p_reason: 'typo' }])
    expect(calls[1]).toEqual(['rpc/delete_sale', { p_sale_id: 's1', p_reason: 'duplicate' }])
    expect(calls[2][0]).toBe(`audit_log?branch_id=eq.${A}&target_type=eq.sale&target_id=eq.s1&order=created_at.desc&select=id,action,actor_type,metadata,created_at`)
  })
})
