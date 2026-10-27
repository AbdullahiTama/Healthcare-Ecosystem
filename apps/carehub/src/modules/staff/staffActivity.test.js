import { describe, it, expect } from 'vitest'
import { periodRange, filterActivity, summarisePeople, filterChoices, personKey, kindLabel } from './staffActivity'
import { createStaffActivityRepository } from './repositories'

const row = (o) => ({ occurred_at: '2026-10-27T09:00:00Z', kind: 'sale', staff_id: null, actor_name: 'Rep One', actor_role: 'Cashier', summary: 'T1 · Ada · Cash', amount: 1000, ref: 'T1', ...o })
const rows = [
  row({ staff_id: 's1', amount: 1500, ref: 'T1' }),
  row({ staff_id: 's1', amount: 500, ref: 'T2', occurred_at: '2026-10-27T11:00:00Z' }),
  row({ staff_id: 's1', kind: 'held', amount: 900, ref: 'H1' }),
  row({ staff_id: 's1', kind: 'refund', amount: 100, ref: 'T1' }),
  row({ staff_id: 's2', actor_name: 'Rep Two', actor_role: 'Pharmacist', kind: 'expense', amount: 2500, summary: 'Transport · Fuel', ref: null }),
  row({ staff_id: null, actor_name: 'Owner or unlinked', actor_role: null, kind: 'sale_edited', summary: 'T2 · typo', ref: 'T2' }),
]

describe('staff activity helpers', () => {
  it('summarises per person: sales value excludes held sales, refunds shown apart, newest first', () => {
    const p = summarisePeople(rows)
    expect(p).toHaveLength(3)
    const one = p.find((x) => x.name === 'Rep One')
    expect(one).toMatchObject({ total: 4, salesValue: 2000, refundValue: 100, sensitive: 1 })
    expect(one.counts).toEqual({ sale: 2, held: 1, refund: 1 })
    expect(one.last).toBe('2026-10-27T11:00:00Z')
    expect(p[0].name).toBe('Rep One') // most actions first
  })
  it('treats the Owner / unlinked actor as one person', () => {
    expect(personKey(rows[5])).toBe('name:owner or unlinked')
    expect(personKey(rows[0])).toBe('s1')
  })
  it('filters by person, role, activity and text', () => {
    expect(filterActivity(rows, { person: 's2' })).toHaveLength(1)
    expect(filterActivity(rows, { role: 'Cashier' })).toHaveLength(4)
    expect(filterActivity(rows, { role: 'Owner or unlinked' })).toHaveLength(1)
    expect(filterActivity(rows, { kind: 'refund' })).toHaveLength(1)
    expect(filterActivity(rows, { query: 'fuel' })).toHaveLength(1)
    expect(filterActivity(rows, { query: 't2' })).toHaveLength(2)
    expect(filterActivity(rows, { person: 's1', kind: 'sale' })).toHaveLength(2)
    expect(filterActivity(rows, {})).toHaveLength(6)
  })
  it('offers only choices present in the data', () => {
    const c = filterChoices(rows)
    expect(c.roles.map((r) => r.value)).toEqual(['Cashier', 'Owner or unlinked', 'Pharmacist'])
    expect(c.kinds.map((k) => k.label)).toContain('Sale edited')
    expect(c.people).toHaveLength(3)
  })
  it('computes local-calendar periods with Monday weeks', () => {
    const now = new Date(2026, 9, 28, 15) // Wed 28 Oct 2026
    expect(periodRange('today', { now }).start).toEqual(new Date(2026, 9, 28))
    const w = periodRange('week', { now })
    expect(w.start).toEqual(new Date(2026, 9, 26)); expect(w.end).toEqual(new Date(2026, 10, 2))
    expect(periodRange('month', { now }).end).toEqual(new Date(2026, 10, 1))
  })
  it('custom range is inclusive, and rejects reversed, unreadable or over-366-day ranges', () => {
    expect(periodRange('custom', { from: '2026-10-01', to: '2026-10-03' }).end).toEqual(new Date(2026, 9, 4))
    expect(periodRange('custom', { from: '2026-10-03', to: '2026-10-01' })).toBeNull()
    expect(periodRange('custom', { from: 'x', to: '2026-10-01' })).toBeNull()
    expect(periodRange('custom', { from: '2025-01-01', to: '2026-10-01' })).toBeNull()
    expect(periodRange('nope')).toBeNull()
  })
  it('the repository calls the owner-only database function with the bounds and cap', async () => {
    const calls = []
    const repo = createStaffActivityRepository({ request: async (p, o) => { calls.push([p, JSON.parse(o.body)]); return [{ kind: 'sale' }] } })
    expect(await repo.get('b1', 'F', 'T', 50)).toEqual([{ kind: 'sale' }])
    expect(calls[0]).toEqual(['rpc/staff_activity', { p_business_id: 'b1', p_from: 'F', p_to: 'T', p_limit: 50 }])
    expect(await createStaffActivityRepository({ request: async () => null }).get('b1', 'F', 'T')).toEqual([])
  })
})
