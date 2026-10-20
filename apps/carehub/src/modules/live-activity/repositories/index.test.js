import { describe, it, expect } from 'vitest'
import { createLiveActivityRepository, buildActivityQuery } from './index.js'

const recording = () => {
  const calls = []
  const counts = []
  const repo = createLiveActivityRepository({
    request: async (path) => { calls.push(path); return [] },
    requestWithCount: async (path, opts) => { counts.push({ path, opts }); return { total: 4321 } },
  })
  return { calls, counts, repo }
}

describe('liveActivityRepository.getFieldActivities', () => {
  it('defaults to the newest 100, ordered by time then id so ties have a fixed order', async () => {
    const { repo, calls } = recording()
    await repo.getFieldActivities('b1')
    expect(calls[0]).toBe('field_activities?business_id=eq.b1&order=created_at.desc,id.desc&select=*&limit=100')
  })

  it('pages strictly after the cursor row: older time, or the same time with a smaller id', async () => {
    const { repo, calls } = recording()
    await repo.getFieldActivities('b1', { limit: 50, cursor: { created_at: '2026-10-19T12:00:00+00:00', id: 'row-9' } })
    expect(calls[0]).toBe(
      'field_activities?business_id=eq.b1'
      + '&or=(created_at.lt.2026-10-19T12%3A00%3A00%2B00%3A00,and(created_at.eq.2026-10-19T12%3A00%3A00%2B00%3A00,id.lt.row-9))'
      + '&order=created_at.desc,id.desc&select=*&limit=50')
  })
})

describe('buildActivityQuery scopes', () => {
  it('own reports of a staff member', () => {
    expect(buildActivityQuery('b1', { staffId: 's1' })).toContain('&staff_id=eq.s1')
  })
  it('own reports of the owner are the ones with no staff author', () => {
    expect(buildActivityQuery('b1', { ownerOnly: true })).toContain('&staff_id=is.null')
  })
  it('shared-with-me excludes the person\'s own reports but keeps the owner\'s', () => {
    expect(buildActivityQuery('b1', { excludeStaffId: 's1' })).toContain('&or=(staff_id.is.null,staff_id.neq.s1)')
  })
  it('combines two OR conditions with and=() instead of repeating or=', () => {
    const q = buildActivityQuery('b1', { excludeStaffId: 's1', cursor: { created_at: 'T', id: 'i' } })
    expect(q.match(/[&?]or=/g)).toBeNull()
    expect(q).toContain('&and=(or(staff_id.is.null,staff_id.neq.s1),or(created_at.lt.T,and(created_at.eq.T,id.lt.i)))')
  })
  it('date window and territory', () => {
    const q = buildActivityQuery('b1', { since: '2026-10-01T00:00:00.000Z', until: '2026-10-31T23:59:59.999Z', territoryId: 't1' })
    expect(q).toContain('&created_at=gte.2026-10-01T00%3A00%3A00.000Z')
    expect(q).toContain('&created_at=lte.2026-10-31T23%3A59%3A59.999Z')
    expect(q).toContain('&territory_id=eq.t1')
  })
})

describe('liveActivityRepository.countFieldActivities', () => {
  it('asks the server for an exact count with no rows, so it is not capped at 1000', async () => {
    const { repo, counts } = recording()
    const n = await repo.countFieldActivities('b1', { staffId: 's1' })
    expect(n).toBe(4321)
    expect(counts[0].path).toBe('field_activities?business_id=eq.b1&staff_id=eq.s1&select=id')
    expect(counts[0].opts).toEqual({ head: true })
  })
})

describe('liveActivityRepository.getAllFieldActivities', () => {
  const rowsOf = (from, n) => Array.from({ length: n }, (_, i) => ({ id: 'r' + (from + i), created_at: 'T' + (from + i) }))
  const withPages = (pages) => {
    const paths = []
    const repo = createLiveActivityRepository({ request: async (p) => { paths.push(p); return pages.shift() || [] } })
    return { repo, paths }
  }

  it('follows the cursor across pages and stops on a short page', async () => {
    const { repo, paths } = withPages([rowsOf(0, 3), rowsOf(3, 3), rowsOf(6, 1)])
    const res = await repo.getAllFieldActivities('b1', {}, { pageSize: 3 })
    expect(res.rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(res.truncated).toBe(false)
    expect(paths[1]).toContain('id.lt.r2')
    expect(paths[2]).toContain('id.lt.r5')
  })

  it('reports truncation when the cap is hit with more left', async () => {
    const { repo } = withPages([rowsOf(0, 3), rowsOf(3, 3)])
    const res = await repo.getAllFieldActivities('b1', {}, { pageSize: 3, max: 6 })
    expect(res.rows).toHaveLength(6)
    expect(res.truncated).toBe(true)
  })

  it('an exact multiple of the page size ends on the following empty page, not as truncated', async () => {
    const { repo } = withPages([rowsOf(0, 3), []])
    const res = await repo.getAllFieldActivities('b1', {}, { pageSize: 3 })
    expect(res.rows).toHaveLength(3)
    expect(res.truncated).toBe(false)
  })
})
