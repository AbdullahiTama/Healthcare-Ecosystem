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

  it('create stamps the tenant onto the new row', async () => {
    const { repo, client } = build()
    await repo.create(A, { full_name: 'Ada', phone: '0800' })
    expect(client.rows('clients')[0]).toMatchObject({ full_name: 'Ada', business_id: A })
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
