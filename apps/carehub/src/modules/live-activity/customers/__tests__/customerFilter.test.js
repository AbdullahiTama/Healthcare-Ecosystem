import { describe, it, expect } from 'vitest'
import { filterCustomers, NOT_VISITED_CHOICES, LIST_LIMIT } from '../customerFilter.js'

const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime()
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString()
const ROWS = [
  { key: 'a', name: 'Allen Pharmacy', address: '1 Marina, Lagos', territory_id: 't1', rep_staff_ids: ['r1', 'r2'], last_visit_at: daysAgo(2) },
  { key: 'b', name: 'Mercy Clinic', address: 'Yaba', territory_id: 't2', rep_staff_ids: ['r2'], last_visit_at: daysAgo(30) },
  { key: 'c', name: 'Kemi Stores', address: null, territory_id: null, rep_staff_ids: ['r1'], last_visit_at: daysAgo(31) },
  { key: 'd', name: 'Old Friend', address: 'Ikeja', territory_id: 't1', rep_staff_ids: [], last_visit_at: daysAgo(100) },
]
const keys = (rows) => rows.map((r) => r.key)

describe('filterCustomers', () => {
  it('no filters keeps everything in order', () => {
    expect(keys(filterCustomers(ROWS, { now: NOW }))).toEqual(['a', 'b', 'c', 'd'])
  })
  it('search matches the name or the address, ignoring case and surrounding spaces', () => {
    expect(keys(filterCustomers(ROWS, { search: '  allen ', now: NOW }))).toEqual(['a'])
    expect(keys(filterCustomers(ROWS, { search: 'IKEJA', now: NOW }))).toEqual(['d'])
  })
  it('territory keeps customers whose territory matches', () => {
    expect(keys(filterCustomers(ROWS, { territoryId: 't1', now: NOW }))).toEqual(['a', 'd'])
  })
  it('rep keeps customers that rep visited at least once', () => {
    expect(keys(filterCustomers(ROWS, { staffId: 'r1', now: NOW }))).toEqual(['a', 'c'])
  })
  it('not visited in 30 days keeps only customers last visited MORE than 30 days ago (exactly 30 is not)', () => {
    expect(keys(filterCustomers(ROWS, { notVisitedDays: 30, now: NOW }))).toEqual(['c', 'd'])
  })
  it('the filters combine', () => {
    expect(keys(filterCustomers(ROWS, { notVisitedDays: 30, territoryId: 't1', now: NOW }))).toEqual(['d'])
    expect(keys(filterCustomers(ROWS, { notVisitedDays: 14, staffId: 'r2', search: 'clinic', now: NOW }))).toEqual(['b'])
  })
  it('tolerates missing rows and missing rep lists', () => {
    expect(filterCustomers(null, { now: NOW })).toEqual([])
    expect(keys(filterCustomers([{ key: 'x', name: 'X', last_visit_at: daysAgo(1) }], { staffId: 'r1', now: NOW }))).toEqual([])
  })
  it('offers any / 14 / 30 / 60 / 90 days and a 500-row list', () => {
    expect(NOT_VISITED_CHOICES.map((c) => c[0])).toEqual([0, 14, 30, 60, 90])
    expect(NOT_VISITED_CHOICES[0][1]).toBe('Any time')
    expect(LIST_LIMIT).toBe(500)
  })
})
