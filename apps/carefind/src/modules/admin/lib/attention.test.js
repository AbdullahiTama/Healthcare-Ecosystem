import { describe, it, expect } from 'vitest'
import { buildAttentionQueue, filterBySeverity, countBySeverity, openItems, oldestTime } from './attention'

const t = (h) => new Date(Date.UTC(2026, 9, 12, h)).toISOString()

const sources = {
  verifications: [
    { id: 'v1', status: 'pending', full_name: 'Amina Yusuf', profession: 'Pharmacist', created_at: t(1) },
    { id: 'v2', status: 'pending', full_name: 'Tunde Ade', profession: 'Nurse', created_at: t(5) },
    { id: 'v3', status: 'approved', full_name: 'Old Case', profession: 'Doctor', created_at: t(9) },
  ],
  claims: [{ id: 'c1', status: 'pending', created_at: t(2), businesses: { name: 'Garki Pharmacy' } }],
  reports: [
    { id: 'r1', status: 'pending', reason: 'spam', created_at: t(3), posts: { content: 'Buy now' } },
    { id: 'r2', status: 'resolved', reason: 'abuse', created_at: t(4), posts: { content: 'x' } },
  ],
  withdrawals: [
    { id: 'w1', status: 'reserved', created_at: t(6), profiles: { full_name: 'Chidi Okafor' } },
    { id: 'w2', status: 'processing', created_at: t(7), profiles: { full_name: 'Ada Eze' } },
    { id: 'w3', status: 'pending', created_at: t(8), profiles: { full_name: 'Legacy Status' } },
    { id: 'w4', status: 'completed', created_at: t(9), profiles: { full_name: 'Done' } },
  ],
  taskSubmissions: [{ id: 's1', status: 'pending', created_at: t(4), tasks: { title: 'Review leaflet' }, profiles: { full_name: 'Dr Eze' } }],
  consultations: [{ id: 'k1', created_at: t(10), profiles: { full_name: 'Dr Ngozi' } }],
  news: [{ id: 'n1', status: 'pending', headline: 'Malaria vaccine rollout', created_at: t(11), profiles: { full_name: 'Fatima Bello' } }],
}

describe('buildAttentionQueue', () => {
  it('builds one row per type with a count of waiting items only', () => {
    const { rows } = buildAttentionQueue(sources)
    const by = Object.fromEntries(rows.map(r => [r.type, r]))
    expect(by.verification.count).toBe(2)
    expect(by.report.count).toBe(1)
    expect(by.claim.count).toBe(1)
    expect(by.task.count).toBe(1)
    expect(by.consultation.count).toBe(1)
    expect(by.news.count).toBe(1)
  })

  it('counts withdrawals that are reserved or processing, not legacy pending or finished ones', () => {
    const { rows } = buildAttentionQueue(sources)
    expect(rows.find(r => r.type === 'withdrawal').count).toBe(2)
  })

  it('shows the newest item as context and its time on each row', () => {
    const { rows } = buildAttentionQueue(sources)
    const v = rows.find(r => r.type === 'verification')
    expect(v.subtitle).toContain('Tunde Ade')
    expect(v.time).toBe(t(5))
    expect(v.oldest).toBe(t(1))
  })

  it('never puts a currency amount in a withdrawal row', () => {
    const { rows } = buildAttentionQueue({ ...sources, withdrawals: [{ id: 'w', status: 'reserved', amount: 200, created_at: t(1), profiles: { full_name: 'A' } }] })
    const w = rows.find(r => r.type === 'withdrawal')
    expect(`${w.title} ${w.subtitle}`).not.toMatch(/[₦\d]{3,}/)
  })

  it('orders by severity (urgent first) then newest first', () => {
    const { rows } = buildAttentionQueue(sources)
    expect(rows[0].type).toBe('report')
    const sevs = rows.map(r => r.severity)
    const rank = { urgent: 0, warning: 1, info: 2 }
    expect(sevs).toEqual([...sevs].sort((a, b) => rank[a] - rank[b]))
    const warnings = rows.filter(r => r.severity === 'warning').map(r => new Date(r.time).getTime())
    expect(warnings).toEqual([...warnings].sort((a, b) => b - a))
  })

  it('omits a type that has nothing waiting', () => {
    const { rows } = buildAttentionQueue({ ...sources, claims: [] })
    expect(rows.some(r => r.type === 'claim')).toBe(false)
  })

  it('reports an unavailable source instead of treating it as empty', () => {
    const { rows, unavailable } = buildAttentionQueue({ ...sources, reports: null, withdrawals: undefined })
    expect(unavailable.sort()).toEqual(['report', 'withdrawal'])
    expect(rows.some(r => r.type === 'report' || r.type === 'withdrawal')).toBe(false)
  })

  it('does not throw on damaged records', () => {
    const { rows } = buildAttentionQueue({ ...sources, verifications: [{ id: 'x', status: 'pending' }], claims: [{ id: 'y', status: 'pending', businesses: null }], news: [{ id: 'z', status: 'pending' }] })
    expect(rows.find(r => r.type === 'verification').count).toBe(1)
    expect(rows.find(r => r.type === 'claim').subtitle).toBeTruthy()
    expect(rows.find(r => r.type === 'news').subtitle).toBeTruthy()
  })

  it('points each row at the existing tab, and consultations at none', () => {
    const { rows } = buildAttentionQueue(sources)
    const tab = Object.fromEntries(rows.map(r => [r.type, r.tab]))
    expect(tab).toMatchObject({ verification: 'verifications', claim: 'claims', report: 'reports', withdrawal: 'withdrawals', task: 'tasks', news: 'news', consultation: null })
  })
})

describe('capped sources', () => {
  it('marks rows from a capped list as a lower bound', () => {
    const { rows } = buildAttentionQueue(sources, { capped: ['reports'] })
    expect(rows.find(r => r.type === 'report').atLeast).toBe(true)
    expect(rows.find(r => r.type === 'claim').atLeast).toBe(false)
  })
})

describe('severity helpers', () => {
  it('counts items, not rows, per severity', () => {
    const { rows } = buildAttentionQueue(sources)
    expect(countBySeverity(rows)).toEqual({ all: 9, urgent: 1, warning: 6, info: 2 })
  })
  it('filters rows by severity and returns all for "all"', () => {
    const { rows } = buildAttentionQueue(sources)
    expect(filterBySeverity(rows, 'all')).toHaveLength(rows.length)
    expect(filterBySeverity(rows, 'info').map(r => r.type).sort()).toEqual(['consultation', 'task'])
  })
})

describe('openItems and oldestTime', () => {
  it('uses the same definition of waiting as the queue', () => {
    expect(openItems('withdrawal', sources.withdrawals).map(w => w.id)).toEqual(['w1', 'w2'])
    expect(openItems('verification', sources.verifications)).toHaveLength(2)
  })
  it('returns nothing for a missing list or unknown type', () => {
    expect(openItems('report', null)).toEqual([])
    expect(openItems('nope', [])).toEqual([])
  })
  it('finds the oldest time, or null when there is none', () => {
    expect(oldestTime(openItems('verification', sources.verifications))).toBe(t(1))
    expect(oldestTime([])).toBeNull()
    expect(oldestTime([{ id: 'x' }])).toBeNull()
  })
})
