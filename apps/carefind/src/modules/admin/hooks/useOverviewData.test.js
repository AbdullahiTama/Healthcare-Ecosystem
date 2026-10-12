import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAdminAuth = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => vi.fn())
const consults = vi.hoisted(() => vi.fn())

vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../repositories/transport', () => ({ adminTransport: { query } }))
vi.mock('../repositories', () => ({ dashboardRepository: { getProfessionalConsultations: consults } }))

import { loadOverview, listsFrom, SOURCE_CAPS } from './useOverviewData'

const reply = {
  list_verification_requests: [{ id: 'v1', status: 'pending' }],
  list_business_claims: [],
  list_reports: [{ id: 'r1', status: 'pending' }],
  list_transactions: [{ id: 't1' }],
  list_withdrawal_requests: [],
  list_task_submissions: [],
  list_news: [],
}

beforeEach(() => {
  callAdminAuth.mockReset().mockImplementation(async (action) => ({ data: reply[action] }))
  consults.mockReset().mockResolvedValue([])
  query.mockReset().mockImplementation(async (table) => ({ data: [], count: table === 'profiles' ? 4218 : table === 'businesses' ? 312 : 41 }))
})

describe('loadOverview', () => {
  it('returns every source as ok with its data', async () => {
    const r = await loadOverview()
    expect(r.sources.verifications).toEqual({ status: 'ok', data: reply.list_verification_requests })
    expect(r.totals.users).toEqual({ status: 'ok', data: 4218 })
    expect(r.totals.businesses).toEqual({ status: 'ok', data: 312 })
    expect(r.totals.posts24h).toEqual({ status: 'ok', data: 41 })
  })

  it('marks only the failing source as an error and keeps the rest', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_transactions') throw new Error('Request failed (500)')
      return { data: reply[action] }
    })
    const r = await loadOverview()
    expect(r.sources.transactions.status).toBe('error')
    expect(r.sources.transactions.data).toBeUndefined()
    expect(r.sources.reports.status).toBe('ok')
  })

  it('marks a failed head count as an error, never 0', async () => {
    query.mockImplementation(async (table) => { if (table === 'profiles') throw new Error('boom'); return { data: [], count: 1 } })
    const r = await loadOverview()
    expect(r.totals.users.status).toBe('error')
  })

  it('treats a head count with no count as an error, not 0', async () => {
    query.mockImplementation(async () => ({ data: [], count: null }))
    const r = await loadOverview()
    expect(r.totals.users.status).toBe('error')
  })

  it('counts posts from the last 24 hours only', async () => {
    await loadOverview(new Date('2026-10-12T12:00:00Z'))
    const call = query.mock.calls.find(c => c[0] === 'posts')
    expect(call[1].count).toBe('head')
    expect(call[1].filters).toEqual([{ op: 'gte', col: 'created_at', val: '2026-10-11T12:00:00.000Z' }])
  })

  it('does not call any endpoint that was not already in use', async () => {
    await loadOverview()
    expect(callAdminAuth.mock.calls.map(c => c[0]).sort()).toEqual(Object.keys(reply).sort())
  })
})

describe('listsFrom', () => {
  it('turns ok sources into arrays and failed ones into null', async () => {
    callAdminAuth.mockImplementation(async (action) => { if (action === 'list_reports') throw new Error('x'); return { data: reply[action] } })
    const { lists } = listsFrom(await loadOverview())
    expect(lists.reports).toBeNull()
    expect(lists.verifications).toHaveLength(1)
  })

  it('flags a list as capped when it holds as many rows as the server returns', () => {
    const full = Array.from({ length: SOURCE_CAPS.reports }, (_, i) => ({ id: i }))
    const { capped } = listsFrom({ sources: { reports: { status: 'ok', data: full }, claims: { status: 'ok', data: [] } }, totals: {} })
    expect(capped).toEqual(['reports'])
  })
})
