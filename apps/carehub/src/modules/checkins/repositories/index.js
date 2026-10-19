import { sbFetch } from '../../../services/supabase'

// Check-in transport seam. Authorisation is NOT decided here: record_checkin()
// resolves the caller's membership from their own login, and
// manager_checkin_overview() requires is_business_manager() and records every
// access (carehub_20261123_staff_checkins.sql). A client-supplied business id
// grants nothing by itself.

const FAILURE_REASONS = ['denied', 'unavailable', 'timeout', 'unsupported', 'invalid']
const MINE_COLUMNS = 'id,business_id,event_type,status,latitude,longitude,accuracy_m,location_label,failure_reason,created_at'

const one = (res) => (Array.isArray(res) ? res[0] : res)

export function createCheckinRepository(request = sbFetch) {
  return {
    // `capture` is the result of captureLocation(): { ok:true, lat, lng, accuracyM, capturedAt }
    // or { ok:false, reason }. A failed capture is recorded AS failed, with no position.
    async record(businessId, eventType, capture) {
      if (!businessId) throw new Error('No business selected.')
      const body = { p_business_id: businessId, p_event_type: eventType }
      if (capture && capture.ok) {
        Object.assign(body, {
          p_lat: capture.lat, p_lng: capture.lng, p_accuracy_m: capture.accuracyM == null ? null : Math.round(capture.accuracyM),
          p_source: 'browser_geolocation', p_client_captured_at: capture.capturedAt || null,
        })
      } else {
        body.p_failure_reason = FAILURE_REASONS.includes(capture && capture.reason) ? capture.reason : 'unavailable'
      }
      return one(await request('rpc/record_checkin', { method: 'POST', body: JSON.stringify(body) }))
    },

    async overview(businessId) {
      if (!businessId) throw new Error('No business selected.')
      const res = one(await request('rpc/manager_checkin_overview', { method: 'POST', body: JSON.stringify({ p_business_id: businessId }) }))
      return { rows: [], currentWindowMinutes: 60, ...(res || {}) }
    },

    // The caller's own recent events (RLS limits this to their user id).
    async mine(limit = 5) {
      const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50)
      return request('staff_checkins?order=created_at.desc&select=' + MINE_COLUMNS + '&limit=' + n)
    },
  }
}

export const checkinRepository = createCheckinRepository()
