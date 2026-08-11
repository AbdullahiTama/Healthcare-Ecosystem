import { describe, it, expect } from 'vitest'
import { createClientRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

// Builds a repository wired to the in-memory transport, so every assertion is
// about the client aggregate's own query shape and tenant scoping — never the
// network.
function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createClientRepository(client) }
}

describe('clientRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = build({
      clients: [
        { id: 'c1', business_id: A, full_name: 'Ada' },
        { id: 'c9', business_id: B, full_name: 'Other biz client' },
      ],
    })
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.full_name)).toEqual(['Ada'])
  })

  // Same server-side clamp as products: PostgREST returns at most 1000 rows
  // per request, so a >1000-client list (the bulk CSV upload makes that
  // realistic) must be fetched by offset-paging until the last short page.
  it('getAll pages past 1000 clients without dropping any', async () => {
    const client = createInMemoryClient({
      clients: Array.from({ length: 2500 }, (_, i) => ({ id: 'c' + i, business_id: A, full_name: 'Client ' + i })),
    })
    const repo = createClientRepository(client)
    const rows = await repo.getAll(A)
    expect(rows).toHaveLength(2500)
    expect(rows.every((r) => r.business_id === A)).toBe(true)
    expect(client.pages('clients')).toEqual([0, 1000, 2000])
  })

  it('create stamps the tenant onto the new row', async () => {
    const { repo, client } = build()
    await repo.create(A, { full_name: 'Ada', phone: '0800' })
    expect(client.rows('clients')[0]).toMatchObject({ full_name: 'Ada', business_id: A })
  })

  // ── Bulk import ─────────────────────────────────────────────────────────────
  it('createMany inserts every row with the tenant stamped', async () => {
    const { repo, client } = build()
    const rows = Array.from({ length: 45 }, (_, i) => ({ full_name: 'Client ' + i, phone: '080' + i }))
    const result = await repo.createMany(A, rows)

    expect(result.added).toBe(45)
    expect(result.failed).toEqual([])
    const stored = client.rows('clients')
    expect(stored).toHaveLength(45)
    expect(stored.every((r) => r.business_id === A)).toBe(true)
    expect(stored.every((r) => r.phone.startsWith('080'))).toBe(true)
  })

  // One bad row must never sink the whole file: the failing create is captured
  // with its name and message, and every other row still lands.
  it('createMany captures per-row failures without losing the rest', async () => {
    const rejecting = createInMemoryClient()
    const failingRepo = createClientRepository(async (path, options) => {
      const body = JSON.parse(options.body)
      if (body.phone === '080-BAD') throw new Error('duplicate key')
      return rejecting(path, options)
    })
    const result = await failingRepo.createMany(A, [
      { full_name: 'Good One', phone: '0801' },
      { full_name: 'Bad Row', phone: '080-BAD' },
      { full_name: 'Good Two', phone: '0802' },
    ])

    expect(result.added).toBe(2)
    expect(result.failed).toEqual([{ full_name: 'Bad Row', message: 'duplicate key' }])
    expect(rejecting.rows('clients')).toHaveLength(2)
  })

  it('createMany is a no-op for an empty list', async () => {
    const { repo, client } = build()
    const result = await repo.createMany(A, [])
    expect(result).toEqual({ added: 0, failed: [] })
    expect(client.rows('clients')).toHaveLength(0)
  })

  it('update is scoped to the tenant', async () => {
    const { repo, client } = build({
      clients: [
        { id: 'c1', business_id: A, full_name: 'Ada', phone: '0800' },
        { id: 'c9', business_id: B, full_name: 'Other biz client', phone: '0900' },
      ],
    })
    await repo.update('c1', A, { phone: '0111' })
    await repo.update('c9', A, { phone: 'hacked' }) // wrong tenant — must no-op

    const byId = Object.fromEntries(client.rows('clients').map((c) => [c.id, c]))
    expect(byId['c1'].phone).toBe('0111')
    expect(byId['c9'].phone).toBe('0900')
  })

  // ── Per-client history: scoped by client AND tenant ─────────────────────────
  // Each case seeds a same-id row under another tenant, so a read that only
  // filtered on client_id would leak it.
  const history = [
    ['getSales', 'sales', { created_at: '2026-01-01' }],
    ['getAppointments', 'appointments', { date: '2026-01-01' }],
    ['getDebts', 'debts', { created_at: '2026-01-01' }],
    ['getConsultations', 'consultation_forms', { consultation_date: '2026-01-01' }],
  ]

  history.forEach(([method, table, extra]) => {
    it(`${method} returns only this tenant's rows for the client`, async () => {
      const { repo } = build({
        [table]: [
          { id: 'mine', client_id: 'c1', business_id: A, ...extra },
          { id: 'theirs', client_id: 'c1', business_id: B, ...extra },
        ],
      })
      const rows = await repo[method]('c1', A)
      expect(rows.map((r) => r.id)).toEqual(['mine'])
    })
  })

  it('history reads return empty for a client belonging to another tenant', async () => {
    const { repo } = build({
      sales: [{ id: 's1', client_id: 'c9', business_id: B, created_at: '2026-01-01' }],
    })
    expect(await repo.getSales('c9', A)).toEqual([])
  })
})
