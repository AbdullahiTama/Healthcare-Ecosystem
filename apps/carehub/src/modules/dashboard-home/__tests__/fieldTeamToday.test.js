import { describe, it, expect } from 'vitest'
import { summariseFieldDay } from '../fieldTeamToday'

// "Field team today" on the company dashboard: who checked in and today's visits (owner's choice, layout A).
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime() // local noon
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString()
const CUSTOM = { 'Field Rep': { nav: ['activity', 'orders', 'messages'] } }
const person = (name, role, checkedInMinutesAgo, over = {}) => ({
  staff_id: name.toLowerCase(), name, role,
  last_checkin: checkedInMinutesAgo == null ? null : { event_type: 'workday_checkin', at: minsAgo(checkedInMinutesAgo), location_label: 'Ikeja' },
  age_minutes: checkedInMinutesAgo, ...over,
})
const visit = (id, minutesAgo, over = {}) => ({ id, rep_name: 'Ada', created_at: minsAgo(minutesAgo), facility_name: 'Allen Pharmacy', facility_verified: true, ...over })

const base = {
  businessType: 'manufacturer_importer', customRoles: CUSTOM, now: NOW,
  checkins: [
    person('Ada', 'Field Rep', 20),
    person('Musa', 'Medical sales rep', 180),   // unrecognised role at a manufacturer = a rep
    person('Fatima', 'Field Rep', null),
    person('Mo', 'Regional Manager', 30),       // a field manager: not counted as a rep
  ],
  visits: [], ordersAwaiting: [], placesPending: [],
}

describe('summariseFieldDay', () => {
  it('counts reps who checked in today out of all reps, leaving managers and the owner out', () => {
    const s = summariseFieldDay(base)
    expect(s.checkedIn).toBe(2)
    expect(s.repsTotal).toBe(3)
    expect(s.checkinRows.map((r) => r.name)).toEqual(['Ada', 'Musa', 'Fatima'])
  })

  it('marks a check-in older than 60 minutes as stale, and a rep with none today as missing', () => {
    const rows = Object.fromEntries(summariseFieldDay(base).checkinRows.map((r) => [r.name, r]))
    expect(rows.Ada).toMatchObject({ stale: false, missing: false, area: 'Ikeja' })
    expect(rows.Musa).toMatchObject({ stale: true, missing: false })
    expect(rows.Fatima).toMatchObject({ missing: true, at: null })
  })

  it('a check-in from yesterday is not today: the rep is missing', () => {
    const s = summariseFieldDay({ ...base, checkins: [person('Ada', 'Field Rep', 13 * 60)] })
    expect(s.checkedIn).toBe(0)
    expect(s.checkinRows[0].missing).toBe(true)
  })

  it('lists today\'s visits newest first, at most 8, without yesterday\'s', () => {
    const visits = [visit('old', 13 * 60), ...Array.from({ length: 10 }, (_, i) => visit('v' + i, i * 5))]
    const s = summariseFieldDay({ ...base, visits })
    expect(s.visitsToday).toBe(10)
    expect(s.visitRows).toHaveLength(8)
    expect(s.visitRows[0].id).toBe('v0')
    expect(s.visitRows.map((v) => v.id)).not.toContain('old')
  })

  it('a visit row says who, where, the location badge and whether it carries photos', () => {
    const s = summariseFieldDay({ ...base, visits: [visit('a', 5, { photo_paths: ['b/a-0.jpg'] }), visit('b', 10, { facility_name: null, location_label: null, facility_verified: false })] })
    expect(s.visitRows[0]).toMatchObject({ rep: 'Ada', place: 'Allen Pharmacy', badge: 'verified', hasPhoto: true })
    expect(s.visitRows[1]).toMatchObject({ place: 'No place recorded', badge: 'unverified', hasPhoto: false })
  })

  it('counts orders awaiting approval and places to confirm', () => {
    const s = summariseFieldDay({ ...base, ordersAwaiting: [{ id: 'o1' }, { id: 'o2' }], placesPending: [{ id: 'p1' }] })
    expect(s.ordersToApprove).toBe(2)
    expect(s.placesToConfirm).toBe(1)
  })

  it('missing inputs (a section that failed to load) count as nothing, not a crash', () => {
    const s = summariseFieldDay({ businessType: 'wholesale', now: NOW })
    expect(s).toMatchObject({ checkedIn: 0, repsTotal: 0, visitsToday: 0, ordersToApprove: 0, placesToConfirm: 0, checkinRows: [], visitRows: [] })
  })
})
