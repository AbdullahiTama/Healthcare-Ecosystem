import { describe, it, expect } from 'vitest'
import { createDirectoryRepository } from '../../business-directory/repositories'
import { createInMemoryClient } from '../../../test/inMemoryClient'

const A = 'biz-A'
const B = 'biz-B'

function recording(ret = []) {
  const calls = []
  return { calls, repo: createDirectoryRepository(async (p, o) => { calls.push({ path: p, method: o?.method, body: o?.body ? JSON.parse(o.body) : null }); return ret }) }
}

describe('territory intelligence RPC requests', () => {
  it('coverageSummary posts the tenant, window, grouping and filters to the right function', async () => {
    const { repo, calls } = recording()
    await repo.coverageSummary(A, '2026-07-01T00:00:00Z', 'state', { categoryId: 'c1', state: 'Lagos', unassignedOnly: true })
    expect(calls[0]).toEqual({ path: 'rpc/directory_coverage_summary', method: 'POST', body: {
      p_business_id: A, p_since: '2026-07-01T00:00:00Z', p_group: 'state', p_category_id: 'c1', p_state: 'Lagos', p_unassigned_only: true } })
  })
  it('defaults leave every optional filter null/false', async () => {
    const { repo, calls } = recording()
    await repo.coverageSummary(A, 'x', 'territory')
    expect(calls[0].body).toMatchObject({ p_category_id: null, p_state: null, p_unassigned_only: false })
  })
  it('unvisited carries paging and filters', async () => {
    const { repo, calls } = recording()
    await repo.unvisited(A, 'x', { territoryId: 't1', limit: 50, offset: 100 })
    expect(calls[0].path).toBe('rpc/directory_unvisited')
    expect(calls[0].body).toMatchObject({ p_business_id: A, p_territory_id: 't1', p_unassigned_only: false, p_limit: 50, p_offset: 100 })
  })
  it('visitTotals unwraps the single row; repActivity returns rows', async () => {
    expect(await recording([{ activities_total: 3 }]).repo.visitTotals(A, 'x')).toEqual({ activities_total: 3 })
    expect(await recording([]).repo.visitTotals(A, 'x')).toBeNull()
    const { repo, calls } = recording([{ staff_id: 's' }])
    expect(await repo.repActivity(A, 'x')).toHaveLength(1)
    expect(calls[0].path).toBe('rpc/directory_rep_activity')
  })
})

describe('assignTerritoryToUnassigned', () => {
  function seeded() {
    const client = createInMemoryClient({
      directory_businesses: [
        { id: '1', business_id: A, state: 'Lagos', territory_id: null, is_active: true },
        { id: '2', business_id: A, state: 'Lagos', territory_id: 'old', is_active: true },
        { id: '3', business_id: A, state: 'Oyo', territory_id: null, is_active: true },
        { id: '4', business_id: A, state: 'Lagos', territory_id: null, is_active: false },
        { id: '5', business_id: B, state: 'Lagos', territory_id: null, is_active: true },
      ],
    })
    return { client, repo: createDirectoryRepository(client) }
  }
  const terr = (client, id) => client.rows('directory_businesses').find((r) => r.id === id).territory_id

  it('fills only unassigned, active, same-tenant rows and reports the count', async () => {
    const { repo, client } = seeded()
    expect(await repo.assignTerritoryToUnassigned(A, 't-new')).toBe(2)
    expect(terr(client, '1')).toBe('t-new')
    expect(terr(client, '3')).toBe('t-new')
    expect(terr(client, '2')).toBe('old') // never overwrites
    expect(terr(client, '4')).toBeNull() // inactive untouched
    expect(terr(client, '5')).toBeNull() // other tenant untouched
  })
  it('can be limited to one state', async () => {
    const { repo, client } = seeded()
    expect(await repo.assignTerritoryToUnassigned(A, 't-new', { state: 'Oyo' })).toBe(1)
    expect(terr(client, '3')).toBe('t-new')
    expect(terr(client, '1')).toBeNull()
  })
})
