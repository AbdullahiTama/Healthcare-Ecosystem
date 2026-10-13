import { describe, it, expect } from 'vitest'
import { buildAlerts } from './buildAlerts'

const ok = (data = []) => ({ status: 'ok', data })
const err = { status: 'error' }
const sources = (o = {}) => ({
  verifications: ok(), claims: ok(), reports: ok(), withdrawals: ok(),
  taskSubmissions: ok(), consultations: ok(), news: ok(), ...o,
})
const one = (key, row) => buildAlerts(sources({ [key]: ok([row]) })).alerts[0]

describe('buildAlerts', () => {
  it('maps a pending verification', () => {
    expect(one('verifications', { id: 'v', status: 'pending', full_name: 'Ada', profession: 'Nurse', created_at: '2026-01-01' }))
      .toMatchObject({ id: 'v', type: 'verification', title: 'Verification request from Ada', subtitle: 'Nurse', severity: 'warning', tab: 'verifications' })
  })
  it('maps a pending claim', () => {
    expect(one('claims', { id: 'c', status: 'pending', businesses: { name: 'Pharma' }, created_at: '2026-01-01' }))
      .toMatchObject({ type: 'claim', title: 'Business claim: Pharma', subtitle: 'Pending approval', severity: 'warning', tab: 'claims' })
  })
  it('maps a pending report with a 60 char subtitle', () => {
    const a = one('reports', { id: 'r', status: 'pending', reason: 'spam', posts: { content: 'x'.repeat(100) }, created_at: '2026-01-01' })
    expect(a).toMatchObject({ type: 'report', title: 'Post reported: spam', severity: 'urgent', tab: 'reports' })
    expect(a.subtitle).toHaveLength(60)
  })
  it('maps a pending withdrawal, with fallback name', () => {
    expect(one('withdrawals', { id: 'w', status: 'pending', amount: 5000, profiles: { full_name: 'Bo' }, created_at: '2026-01-01' }))
      .toMatchObject({ type: 'withdrawal', title: `Withdrawal request: ₦${(1000000).toLocaleString()}`, subtitle: 'Bo', severity: 'warning', tab: 'withdrawals' })
    expect(one('withdrawals', { id: 'w', status: 'pending', amount: 1, profiles: null, created_at: '2026-01-01' }).subtitle).toBe('User')
  })
  it('maps a pending task submission', () => {
    expect(one('taskSubmissions', { id: 't', status: 'pending', tasks: { title: 'Survey' }, profiles: null, created_at: '2026-01-01' }))
      .toMatchObject({ type: 'task', title: 'Task submission: Survey', subtitle: 'Professional', severity: 'info', tab: 'tasks' })
  })
  it('counts every consultation regardless of status', () => {
    const r = buildAlerts(sources({ consultations: ok([{ id: 'a', status: 'paid', created_at: '2026-01-01' }, { id: 'b', status: 'done', profiles: { full_name: 'Dr X' }, created_at: '2026-01-02' }]) }))
    expect(r.alerts).toHaveLength(2)
    expect(r.alerts[0]).toMatchObject({ type: 'consultation', title: 'New consultation booking', subtitle: 'Dr X', severity: 'info', tab: 'overview' })
    expect(r.alerts[1].subtitle).toBe('Professional')
  })
  it('maps pending news with truncated headline and subtitle fallbacks', () => {
    const a = one('news', { id: 'n', status: 'pending', headline: 'h'.repeat(80), profiles: { display_name: 'Cy' }, created_at: '2026-01-01' })
    expect(a).toMatchObject({ type: 'news', subtitle: 'Cy', severity: 'warning', tab: 'news' })
    expect(a.title).toBe(`News submission: ${'h'.repeat(60)}`)
    expect(one('news', { id: 'n', status: 'pending', created_at: '2026-01-01' })).toMatchObject({ title: 'News submission: New article', subtitle: 'Contributor' })
  })
  it('ignores non-pending rows', () => {
    const r = buildAlerts(sources({ verifications: ok([{ id: 'v', status: 'approved' }]), news: ok([{ id: 'n', status: 'published' }]) }))
    expect(r).toEqual({ alerts: [], failed: [] })
  })
  it('an error source adds no alerts and is named in failed, in fixed order', () => {
    expect(buildAlerts(sources({ withdrawals: err }))).toEqual({ alerts: [], failed: ['Withdrawals'] })
    expect(buildAlerts(sources({ news: err, verifications: err, consultations: err })).failed).toEqual(['Verifications', 'Consultations', 'News'])
  })
  it('keeps alerts from healthy sources when another fails', () => {
    const r = buildAlerts(sources({ claims: err, reports: ok([{ id: 'r', status: 'pending', reason: 'x', created_at: '2026-01-01' }]) }))
    expect(r.alerts).toHaveLength(1)
    expect(r.failed).toEqual(['Claims'])
  })
  it('sorts newest first', () => {
    const r = buildAlerts(sources({
      verifications: ok([{ id: 'old', status: 'pending', created_at: '2026-01-01' }]),
      reports: ok([{ id: 'new', status: 'pending', created_at: '2026-03-01' }]),
      news: ok([{ id: 'mid', status: 'pending', created_at: '2026-02-01' }]),
    }))
    expect(r.alerts.map(a => a.id)).toEqual(['new', 'mid', 'old'])
  })
  it('does not throw on null nested objects', () => {
    expect(() => buildAlerts(sources({
      claims: ok([{ id: 'c', status: 'pending', businesses: null, created_at: '2026-01-01' }]),
      reports: ok([{ id: 'r', status: 'pending', posts: null, created_at: '2026-01-01' }]),
      taskSubmissions: ok([{ id: 't', status: 'pending', tasks: null, profiles: null, created_at: '2026-01-01' }]),
    }))).not.toThrow()
  })
})
