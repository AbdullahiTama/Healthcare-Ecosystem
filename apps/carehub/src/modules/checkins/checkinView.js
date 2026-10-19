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
