// Presentation rules for check-in data. Pure functions so the wording that keeps
// stale or missing positions from looking current is unit-tested.

export const EVENT_LABEL = {
  workday_checkin: 'Checked in',
  workday_checkout: 'Checked out',
  location_capture: 'Location shared',
}

export const FAILURE_TEXT = {
  denied: 'location permission was denied',
  unavailable: 'the position could not be determined',
  timeout: 'finding the position took too long',
  unsupported: 'this browser cannot share a location',
  invalid: 'the device returned an unusable position',
}

export function formatAge(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return ''
  const m = Math.max(0, Math.round(Number(minutes)))
  if (m < 1) return 'just now'
  if (m < 60) return m + ' min ago'
  const h = Math.floor(m / 60)
  if (h < 48) return h + (h === 1 ? ' hour ago' : ' hours ago')
  return Math.floor(h / 24) + ' days ago'
}

// The same limit manager_checkin_overview uses for freshness 'current' (60 minutes, see
// carehub_20261130_staff_checkins.sql): a position older than this is shown to managers as OLD.
export const STALE_AFTER_MINUTES = 60

/**
 * The person's own latest record -> what their screen says, or null when there is none. It applies the rule
 * managers see: an old position is called old. A failed attempt holds no position, so it is never "stale".
 * `now` is for tests. A missing or unreadable time gives no age and no stale warning, never a guess.
 */
export function describeOwnRecord(last, now = Date.now()) {
  if (!last) return null
  const label = EVENT_LABEL[last.event_type] || 'Checked in'
  const at = Date.parse(last.created_at)
  const minutes = Number.isFinite(at) ? (now - at) / 60000 : null
  const age = minutes == null ? '' : ' ' + formatAge(minutes)
  if (last.status === 'failed') {
    return { stale: false, text: label + age + ', failed (' + (FAILURE_TEXT[last.failure_reason] || 'no position') + ', nothing saved).' }
  }
  const accuracy = last.accuracy_m != null ? ', accuracy about ' + last.accuracy_m + ' m' : ''
  const stale = minutes != null && minutes > STALE_AFTER_MINUTES
  return {
    stale,
    text: label + age + accuracy + '.' + (stale ? ' Your managers see this as an old position, because it is more than an hour old.' : ''),
  }
}

/**
 * One manager-overview row -> what to show. `tone` drives colour; the text
 * never calls a stale or missing position "current", and never says a person
 * is "at" a place: it says where they last checked in and when.
 */
export function describeStaffRow(row) {
  const last = row && row.last_checkin
  const failed = row && row.last_failed_attempt
  let headline, detail, tone
  if (!last) {
    tone = 'none'
    headline = 'No location on record'
    detail = failed ? 'Last attempt failed: ' + (FAILURE_TEXT[failed.reason] || 'unknown reason') + '.' : 'They have not checked in.'
  } else if (row.freshness === 'current') {
    tone = 'current'
    headline = (EVENT_LABEL[last.event_type] || 'Checked in') + ' ' + formatAge(row.age_minutes)
    detail = last.accuracy_m != null ? 'Accuracy about ' + last.accuracy_m + ' m.' : 'Accuracy unknown.'
  } else {
    tone = 'stale'
    headline = 'Last known position, ' + formatAge(row.age_minutes)
    detail = 'This is an old position and may not reflect where they are now.'
  }
  if (last && failed) detail += ' A newer attempt failed: ' + (FAILURE_TEXT[failed.reason] || 'unknown reason') + '.'
  return { tone, headline, detail }
}
