import { describe, it, expect } from 'vitest'
import { sinceFor, pct, coverageTone, shapeGroups, totalsOf, visitStats, daysSince, lastVisitLabel, shapeReps, WINDOWS } from '../coverage'

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)

describe('coverage helpers', () => {
  it('sinceFor goes back whole days', () => {
    expect(sinceFor(30, NOW)).toBe(new Date(NOW - 30 * 86400000).toISOString())
    expect(WINDOWS.map((w) => w.days)).toEqual([30, 60, 90, 180, 365])
  })
  it('pct never divides by zero and rounds', () => {
    expect(pct(0, 0)).toBe(0)
    expect(pct(1, 3)).toBe(33)
    expect(pct(2, 3)).toBe(67)
  })
  it('tone thresholds; nothing to measure is neutral', () => {
    expect(coverageTone(80, 10)).toBe('green')
    expect(coverageTone(50, 10)).toBe('amber')
    expect(coverageTone(10, 10)).toBe('red')
    expect(coverageTone(0, 0)).toBe('gray')
  })
})

describe('shapeGroups', () => {
  const rows = [
    { group_key: 't1', group_label: 'Lagos Mainland', total: '10', visited: '9' },
    { group_key: '', group_label: '', total: 4, visited: 0 },
    { group_key: 't2', group_label: 'Ibadan', total: '5', visited: '1' },
    { group_key: 't3', group_label: 'Abuja', total: '5', visited: '1' },
  ]
  it('coerces bigint strings, labels the blank group and adds percentages', () => {
    const g = shapeGroups(rows, 'territory')
    const none = g.find((x) => x.none)
    expect(none).toMatchObject({ label: 'No territory assigned', total: 4, visited: 0, pct: 0 })
    expect(g.find((x) => x.key === 't1')).toMatchObject({ total: 10, visited: 9, unvisited: 1, pct: 90 })
  })
  it('weakest coverage first, unassigned last, ties by size then name', () => {
    expect(shapeGroups(rows, 'territory').map((x) => x.label)).toEqual(['Abuja', 'Ibadan', 'Lagos Mainland', 'No territory assigned'])
  })
  it('labels are specific to the grouping', () => {
    expect(shapeGroups([{ group_key: '', group_label: '', total: 1, visited: 0 }], 'category')[0].label).toBe('Uncategorised')
    expect(shapeGroups([{ group_key: '', group_label: '', total: 1, visited: 0 }], 'state')[0].label).toBe('No state recorded')
  })
  it('totalsOf rolls up', () => {
    expect(totalsOf(shapeGroups(rows, 'territory'))).toEqual({ total: 24, visited: 11, unvisited: 13, pct: 46 })
    expect(totalsOf([])).toEqual({ total: 0, visited: 0, unvisited: 0, pct: 0 })
  })
})

describe('visit stats and labels', () => {
  it('flags the blind spot only with enough activity and a low confirmed share', () => {
    expect(visitStats({ activities_total: '10', activities_linked: '2', businesses_visited: '2' })).toMatchObject({ linkedShare: 20, unlinked: 8, blindSpot: true })
    expect(visitStats({ activities_total: 10, activities_linked: 8, businesses_visited: 5 }).blindSpot).toBe(false)
    expect(visitStats({ activities_total: 3, activities_linked: 0, businesses_visited: 0 }).blindSpot).toBe(false) // too little data to alarm anyone
    expect(visitStats(null)).toMatchObject({ activities: 0, linkedShare: 0, blindSpot: false })
  })
  it('last visit wording', () => {
    expect(lastVisitLabel(null, NOW)).toBe('Never visited')
    expect(lastVisitLabel(new Date(NOW - 3600000).toISOString(), NOW)).toBe('Today')
    expect(lastVisitLabel(new Date(NOW - 86400000).toISOString(), NOW)).toBe('Yesterday')
    expect(lastVisitLabel(new Date(NOW - 12 * 86400000).toISOString(), NOW)).toBe('12 days ago')
    expect(daysSince('garbage', NOW)).toBeNull()
  })
  it('rep rows', () => {
    expect(shapeReps([{ staff_id: 's1', rep_name: 'Ada', activities: '4', linked_activities: '2', businesses: '1' }])).toEqual([
      { staffId: 's1', name: 'Ada', activities: 4, linked: 2, businesses: 1, linkedShare: 50 }])
    expect(shapeReps(null)).toEqual([])
  })
})
