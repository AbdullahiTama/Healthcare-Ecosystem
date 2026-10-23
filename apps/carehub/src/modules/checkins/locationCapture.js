function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// One-shot browser location capture for check-in. It never throws and
// never fabricates a position: a failure is reported as { ok:false, reason }.
// It is only called from a user action (a button), never on page load, and
// never watches the position continuously.

// Defined in lib/geo.js so the verification rule and the capture warning share one number.
import { LOW_ACCURACY_M } from '../../lib/geo'
export { LOW_ACCURACY_M }

const MESSAGES = {
  unsupported: 'This browser cannot share a location. Choose a state or enter a place instead.',
  denied: 'Location permission was denied. Allow it in your browser settings, or choose a state or place instead.',
  unavailable: 'Your position could not be determined. Try again, or choose a state or place instead.',
  timeout: 'Finding your position took too long. Try again, or choose a state or place instead.',
  invalid: 'The device returned an unusable position. Choose a state or place instead.',
}

export function locationMessage(reason) {
  return MESSAGES[reason] || MESSAGES.unavailable
}

// maximumAgeMs: how stale a cached position the browser may hand back. A check-in is
// happy with a minute-old fix; a report's location evidence asks for a fresh one (0).
export function captureLocation({ timeoutMs = 10000, maximumAgeMs = 60000, geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : undefined, now = () => new Date() } = {}) {
  return new Promise((resolve) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      resolve({ ok: false, reason: 'unsupported', message: MESSAGES.unsupported }); return
    }
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    // Some browsers never call back when the permission prompt is ignored.
    const guard = setTimeout(() => done({ ok: false, reason: 'timeout', message: MESSAGES.timeout }), timeoutMs + 2000)
    try {
      geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(guard)
          const c = pos && pos.coords
          // Number(null) is 0: a missing coordinate must not become (0, 0).
          const lat = c && c.latitude != null ? Number(c.latitude) : NaN
          const lng = c && c.longitude != null ? Number(c.longitude) : NaN
          if (!isValidLatLng(lat, lng)) { done({ ok: false, reason: 'invalid', message: MESSAGES.invalid }); return }
          const accuracyM = c && Number.isFinite(Number(c.accuracy)) ? Math.round(Number(c.accuracy)) : null
          done({
            ok: true, lat, lng, accuracyM,
            lowAccuracy: accuracyM === null || accuracyM > LOW_ACCURACY_M,
            capturedAt: now().toISOString(), source: 'browser_geolocation',
          })
        },
        (err) => {
          clearTimeout(guard)
          // GeolocationPositionError: 1 denied, 2 unavailable, 3 timeout.
          const reason = err && err.code === 1 ? 'denied' : err && err.code === 3 ? 'timeout' : 'unavailable'
          done({ ok: false, reason, message: MESSAGES[reason] })
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs },
      )
    } catch (e) {
      clearTimeout(guard)
      done({ ok: false, reason: 'unavailable', message: MESSAGES.unavailable })
    }
  })
}
