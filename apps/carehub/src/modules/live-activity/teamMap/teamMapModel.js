import { formatAge, STALE_AFTER_MINUTES } from '../../checkins/checkinView'
import { targetLabel, storedVerification } from '../activityTarget'
import { matchText } from '../LocationMatchBadge.jsx'

// The Team map's content, built from data managers can already see: the check-in overview, field reports and quiet
// customers. Pure, so what becomes a pin (and what must not) is tested on its own.
//
// A pin is an EVENT: a check-in or a visit, with its time. A check-in from before today is never a pin, because a
// pin on the map reads as "the rep is here now". Nothing here tracks anyone.

export const RANGES = [['today', 'Today'], ['week', 'This week']]

const DAY_MS = 86400000

function midnight(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Today: since local midnight. This week: the last 7 days including today.
export function rangeStart(range, now = Date.now()) {
  const start = midnight(now)
  if (range !== 'week') return start
  const d = new Date(start)
  d.setDate(d.getDate() - 6)
  return d.getTime()
}

const clock = (iso) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
const hasPosition = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)

// isRep(row) decides who is expected in the field, so office staff are not listed as "not checked in today".
export function buildTeamMap({
  checkins = [], visits = [], quietCustomers = [], now = Date.now(), range = 'today',
  staffId = '', territoryId = '', showQuiet = false, isRep = () => true,
} = {}) {
  const today = midnight(now)
  const pins = []
  const reps = []
  const absent = []

  ;(checkins || []).forEach((row) => {
    if (!isRep(row)) return
    if (staffId && row.staff_id !== staffId) return
    const c = row.last_checkin
    const at = c ? Date.parse(c.at) : NaN
    if (!c || !Number.isFinite(at) || at < today) { absent.push(row.name); return }
    const minutes = (now - at) / 60000
    const tone = c.event_type === 'workday_checkout' ? 'out' : minutes <= STALE_AFTER_MINUTES ? 'current' : 'earlier'
    reps.push({ staffId: row.staff_id, name: row.name, at: c.at, tone, area: c.location_label || '' })
    if (!hasPosition(c.latitude, c.longitude)) return
    pins.push({
      id: 'rep:' + row.staff_id, kind: 'rep', lat: c.latitude, lng: c.longitude, tone, title: row.name,
      lines: [(tone === 'out' ? 'Checked out ' : 'Checked in ') + formatAge(minutes) + ' (' + clock(c.at) + ')', c.location_label || ''].filter(Boolean),
    })
  })

  const from = rangeStart(range, now)
  const visitRows = (visits || [])
    .filter((v) => Date.parse(v.created_at) >= from)
    .filter((v) => !staffId || v.staff_id === staffId)
    .filter((v) => !territoryId || v.territory_id === territoryId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((v) => {
      const atPlace = hasPosition(v.facility_lat, v.facility_lng)
      const atGps = !atPlace && hasPosition(v.lat, v.lng)
      const place = targetLabel(v)
      const named = !!(v.facility_name || v.directory_business_name)
      const row = {
        id: v.id, at: v.created_at, rep: v.rep_name || '', place: place || 'No place recorded',
        positionLabel: atPlace ? 'at the place' : atGps ? 'GPS position' : 'no position',
        match: named ? matchText(storedVerification(v)) : '',
      }
      if (atPlace || atGps) {
        pins.push({
          id: 'visit:' + v.id, kind: 'visit', tone: 'visit',
          lat: atPlace ? v.facility_lat : v.lat, lng: atPlace ? v.facility_lng : v.lng,
          title: place || 'Visit by ' + (v.rep_name || 'a rep'),
          lines: [
            (v.rep_name ? v.rep_name + ' · ' : '') + clock(v.created_at),
            atPlace ? '' : named ? 'GPS position where the report was logged' : 'GPS position (no place chosen)',
            row.match,
          ].filter(Boolean),
        })
      }
      return row
    })

  const quietRows = (quietCustomers || []).map((c) => ({
    key: c.key, name: c.name, rep: c.last_visit_rep || '', days: Math.floor((now - Date.parse(c.last_visit_at)) / DAY_MS),
  }))
  if (showQuiet) {
    ;(quietCustomers || []).forEach((c, i) => {
      if (!hasPosition(c.lat, c.lng)) return
      pins.push({
        id: 'quiet:' + c.key, kind: 'quiet', tone: 'quiet', lat: c.lat, lng: c.lng, title: c.name,
        lines: ['Not visited in ' + quietRows[i].days + ' days', c.last_visit_rep ? 'Last visit by ' + c.last_visit_rep : ''].filter(Boolean),
      })
    })
  }

  return { pins, reps, absent, visitRows, quietRows }
}
