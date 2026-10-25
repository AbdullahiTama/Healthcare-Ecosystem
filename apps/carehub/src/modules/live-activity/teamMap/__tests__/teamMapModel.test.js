import { describe, it, expect } from 'vitest'
import { buildTeamMap, rangeStart, RANGES } from '../teamMapModel.js'

// The Team map shows events (a check-in, a visit), never "where a rep is now". This model turns the data managers
// can already see into pins and list rows.

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime() // local noon
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString()
const person = (id, name, minutesAgo, over = {}) => ({
  staff_id: id, name, role: 'Field Rep',
  last_checkin: minutesAgo == null ? null : { event_type: 'workday_checkin', at: minsAgo(minutesAgo), latitude: 6.5, longitude: 3.4, location_label: 'Ikeja' },
  ...over,
})
const visit = (id, minutesAgo, over = {}) => ({ id, created_at: minsAgo(minutesAgo), rep_name: 'Ada', staff_id: 'ada', territory_id: 't1', lat: 6.5, lng: 3.4, ...over })

describe('rep pins', () => {
  const checkins = [
    person('ada', 'Ada', 20),
    person('bola', 'Bola', 180),
    person('chi', 'Chi', 30, { last_checkin: { event_type: 'workday_checkout', at: minsAgo(30), latitude: 6.6, longitude: 3.3 } }),
    person('dayo', 'Dayo', 60 * 20), // yesterday evening
    person('efe', 'Efe', null),
  ]
  const m = buildTeamMap({ checkins, now: NOW })

  it('only check-ins from today become pins, coloured by how fresh they are', () => {
    const tones = Object.fromEntries(m.pins.filter((p) => p.kind === 'rep').map((p) => [p.title, p.tone]))
    expect(tones).toEqual({ Ada: 'current', Bola: 'earlier', Chi: 'out' })
  })

  it('a check-in from yesterday is never a pin (it would read as "here now"); that rep is listed as not checked in today', () => {
    expect(m.pins.find((p) => p.title === 'Dayo')).toBeUndefined()
    expect(m.absent).toEqual(['Dayo', 'Efe'])
  })

  it('pins say what the position is: a check-in, when, and the area', () => {
    const ada = m.pins.find((p) => p.title === 'Ada')
    expect(ada).toMatchObject({ kind: 'rep', lat: 6.5, lng: 3.4 })
    expect(ada.lines[0]).toMatch(/^Checked in 20 min ago/)
    expect(ada.lines).toContain('Ikeja')
    expect(m.pins.find((p) => p.title === 'Chi').lines[0]).toMatch(/^Checked out/)
  })

  it('a check-in without a position is listed but has no pin', () => {
    const n = buildTeamMap({ checkins: [person('ada', 'Ada', 10, { last_checkin: { event_type: 'workday_checkin', at: minsAgo(10), latitude: null, longitude: null } })], now: NOW })
    expect(n.pins).toEqual([])
    expect(n.reps.map((r) => r.name)).toEqual(['Ada'])
  })

  it('isRep narrows who is expected in the field (office staff are not listed as absent)', () => {
    const n = buildTeamMap({ checkins: [person('ada', 'Ada', 10), person('ofe', 'Office', null, { role: 'Accountant' })], now: NOW, isRep: (row) => row.role === 'Field Rep' })
    expect(n.absent).toEqual([])
  })
})

describe('visit pins', () => {
  it('a visit to a place with a position is pinned at the place; one with only a GPS fix at the GPS position, labelled so', () => {
    const m = buildTeamMap({ visits: [
      visit('v1', 30, { facility_name: 'Allen Pharmacy', facility_lat: 6.45, facility_lng: 3.39, facility_verified: true }),
      visit('v2', 60, { facility_name: null }),
      visit('v3', 90, { lat: null, lng: null }),
    ], now: NOW })
    const pins = Object.fromEntries(m.pins.map((p) => [p.id, p]))
    expect(pins['visit:v1']).toMatchObject({ lat: 6.45, lng: 3.39, tone: 'visit', title: 'Allen Pharmacy' })
    expect(pins['visit:v1'].lines).toContain('Location matches')
    expect(pins['visit:v2']).toMatchObject({ lat: 6.5, lng: 3.4 })
    expect(pins['visit:v2'].lines).toContain('GPS position (no place chosen)')
    expect(pins['visit:v3']).toBeUndefined()
    expect(m.visitRows.map((r) => [r.id, r.positionLabel])).toEqual([['v1', 'at the place'], ['v2', 'GPS position'], ['v3', 'no position']])
  })

  it('Today keeps visits since local midnight; This week the last 7 days', () => {
    const visits = [visit('today', 60), visit('yesterday', 60 * 14), visit('old', 60 * 24 * 9)]
    expect(buildTeamMap({ visits, now: NOW }).visitRows.map((r) => r.id)).toEqual(['today'])
    expect(buildTeamMap({ visits, now: NOW, range: 'week' }).visitRows.map((r) => r.id)).toEqual(['today', 'yesterday'])
    expect(RANGES).toEqual([['today', 'Today'], ['week', 'This week']])
    expect(rangeStart('today', NOW)).toBe(new Date(2026, 9, 25).getTime())
    expect(rangeStart('week', NOW)).toBe(new Date(2026, 9, 19).getTime())
  })
})

describe('filters and layers', () => {
  const checkins = [person('ada', 'Ada', 20), person('bola', 'Bola', 20)]
  const visits = [visit('a1', 10, { staff_id: 'ada', territory_id: 't1' }), visit('b1', 10, { staff_id: 'bola', rep_name: 'Bola', territory_id: 't2' })]

  it('the rep filter applies to rep pins and visits', () => {
    const m = buildTeamMap({ checkins, visits, now: NOW, staffId: 'ada' })
    expect(m.pins.map((p) => p.id).sort()).toEqual(['rep:ada', 'visit:a1'])
  })

  it('the territory filter applies to visits only (reps have no territory of their own)', () => {
    const m = buildTeamMap({ checkins, visits, now: NOW, territoryId: 't2' })
    expect(m.pins.map((p) => p.id).sort()).toEqual(['rep:ada', 'rep:bola', 'visit:b1'])
  })

  it('quiet customers show only when the layer is on, and only those with a position', () => {
    const quietCustomers = [
      { key: 'f:a', name: 'Old Friend', lat: 6.7, lng: 3.5, last_visit_at: minsAgo(60 * 24 * 40), last_visit_rep: 'Ada' },
      { key: 'd:1', name: 'Mercy', lat: null, lng: null, last_visit_at: minsAgo(60 * 24 * 50) },
    ]
    expect(buildTeamMap({ quietCustomers, now: NOW }).pins).toEqual([])
    const m = buildTeamMap({ quietCustomers, now: NOW, showQuiet: true })
    expect(m.pins).toHaveLength(1)
    expect(m.pins[0]).toMatchObject({ kind: 'quiet', tone: 'quiet', title: 'Old Friend' })
    expect(m.pins[0].lines[0]).toBe('Not visited in 40 days')
    expect(m.quietRows.map((r) => r.name)).toEqual(['Old Friend', 'Mercy'])
  })
})
