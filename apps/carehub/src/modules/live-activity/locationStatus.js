import { LOW_ACCURACY_M } from '../checkins/locationCapture'

// What the Log Activity form tells the rep about their location, in words. Pure, so
// each situation is tested on its own: a refused permission, a timeout and an
// unsupported browser need different advice, and none of them stops a report.
//
// The position is evidence of where the phone was, nothing more. It is never
// invented: when it cannot be captured the report simply has no pin.

export const REPORT_GPS_MESSAGES = {
  denied: 'Location permission was denied. Allow it in your browser settings to get nearby suggestions. You can still log this report without a location.',
  unavailable: 'Your position could not be determined. You can try again, or log this report without a location.',
  timeout: 'Finding your position took too long. You can try again, or log this report without a location.',
  unsupported: 'This browser cannot share a location. You can still log this report without one.',
  invalid: 'The device returned an unusable position. You can try again, or log this report without a location.',
}

// -> { tone: 'busy' | 'ok' | 'warn' | 'none', text, note, canRetry }
export function describeReportLocation({ finding, gps, issue }) {
  if (finding) return { tone: 'busy', text: 'Finding where you are…', note: '', canRetry: false }
  if (issue) {
    return {
      tone: 'warn',
      text: REPORT_GPS_MESSAGES[issue.reason] || REPORT_GPS_MESSAGES.unavailable,
      note: '',
      canRetry: issue.reason !== 'unsupported',
    }
  }
  if (gps) {
    const acc = gps.accuracy == null || !Number.isFinite(Number(gps.accuracy)) ? null : Math.round(Number(gps.accuracy))
    const poor = acc === null || acc > LOW_ACCURACY_M
    return {
      tone: 'ok',
      text: acc === null ? 'Position captured (accuracy unknown)' : 'Position captured, accurate to about ' + acc + ' m',
      note: poor ? 'The accuracy is poor, so nearby suggestions may be wrong. Moving outdoors and trying again can help.' : '',
      canRetry: poor,
    }
  }
  return { tone: 'none', text: 'Location not available', note: '', canRetry: true }
}

// The area-name line under it. '' = show nothing.
export function describeArea(area) {
  if (!area) return ''
  if (area.status === 'looking') return 'Looking up the area name…'
  if (area.status === 'ok') return 'Area: ' + area.label
  if (area.status === 'no_result') return 'No area name was found for this position.'
  if (area.status === 'failed') return 'The area name could not be looked up right now. The report does not need it.'
  return ''
}
