import { sbFetch, sbFetchWithCount, sbUpload } from '../../../services/supabase'

// Internal notify helper — writes one notification row per recipient.
// Never throws: a failed notification must not break the action that triggered it.
async function notify(request, businessId, recipients, kind, title, body, link) {
  try {
    if (!recipients || recipients.length === 0) return
    const rows = recipients.map(function (r) {
      return {
        business_id: businessId,
        staff_id: r.staffId || null,
        is_owner: !r.staffId,
        kind, title,
        body: body || null,
        link: link || null,
      }
    })
    await request('staff_notifications', { method: 'POST', body: JSON.stringify(rows), prefer: 'return=minimal' })
  } catch (e) {}
}

// The PostgREST path for a page of activities (or, with `count`, for counting them).
//   staffId        only reports written by this staff member
//   ownerOnly      only reports with no staff author (the owner's own)
//   excludeStaffId everything except this staff member's (owner's reports kept)
//   cursor         { created_at, id } of the last row shown
//   since / until  ISO timestamps, inclusive
// Authorisation is not decided here: row level security still filters every
// result; these options only narrow what the caller asks for.
export function buildActivityQuery(businessId, { limit = 100, cursor = null, staffId = null, ownerOnly = false, excludeStaffId = null, since = null, until = null, territoryId = null, count = false } = {}) {
  let path = 'field_activities?business_id=eq.' + businessId
  const ors = []
  if (ownerOnly) path += '&staff_id=is.null'
  else if (staffId) path += '&staff_id=eq.' + staffId
  if (excludeStaffId) ors.push('staff_id.is.null,staff_id.neq.' + excludeStaffId)
  if (since) path += '&created_at=gte.' + encodeURIComponent(since)
  if (until) path += '&created_at=lte.' + encodeURIComponent(until)
  if (territoryId) path += '&territory_id=eq.' + territoryId
  if (cursor) {
    const t = encodeURIComponent(cursor.created_at)
    ors.push('created_at.lt.' + t + ',and(created_at.eq.' + t + ',id.lt.' + cursor.id + ')')
  }
  if (ors.length === 1) path += '&or=(' + ors[0] + ')'
  else if (ors.length > 1) path += '&and=(' + ors.map(function (o) { return 'or(' + o + ')' }).join(',') + ')'
  if (count) return path + '&select=id'
  return path + '&order=created_at.desc,id.desc&select=*&limit=' + limit
}

export function createLiveActivityRepository({ request = sbFetch, requestWithCount = sbFetchWithCount } = {}) {
  return {
    async getActivityFields(businessId) {
      return request('activity_fields?business_id=eq.' + businessId + '&order=sort_order.asc&select=*')
    },

    async addActivityField(data) {
      return request('activity_fields', { method: 'POST', body: JSON.stringify(data) })
    },

    async deleteActivityField(id) {
      return request('activity_fields?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' })
    },

    async getDefaultViewers(staffId) {
      if (!staffId) return []
      return request('activity_default_viewers?staff_id=eq.' + staffId + '&select=*')
    },

    async setDefaultViewers(businessId, staffId, viewers) {
      if (staffId) {
        await request('activity_default_viewers?staff_id=eq.' + staffId, { method: 'DELETE', prefer: 'return=minimal' })
      }
      if (viewers && viewers.length > 0) {
        const payload = viewers.map(function (v) {
          return { business_id: businessId, staff_id: staffId, viewer_staff_id: v.viewer_staff_id, viewer_name: v.viewer_name }
        })
        await request('activity_default_viewers', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
      }
    },

    // Newest first. `cursor` ({ created_at, id } of the last row already shown)
    // gives keyset paging with a tie-breaker: the next page is every row after it
    // in (created_at, id) order, so rows sharing a timestamp are neither skipped
    // nor repeated. See buildActivityQuery for the scope and window options.
    async getFieldActivities(businessId, opts = {}) {
      return request(buildActivityQuery(businessId, opts))
    },

    // Every row matching the options, fetched page by page with the same cursor
    // as the feed, for export. Stops at `max` and says so, so a huge history is
    // reported as truncated rather than silently cut.
    async getAllFieldActivities(businessId, opts = {}, { max = 10000, pageSize = 1000 } = {}) {
      const rows = []
      let cursor = null
      while (rows.length < max) {
        const page = await request(buildActivityQuery(businessId, { ...opts, limit: Math.min(pageSize, max - rows.length), cursor }))
        const list = Array.isArray(page) ? page : []
        rows.push(...list)
        if (list.length < Math.min(pageSize, max - (rows.length - list.length))) return { rows, truncated: false }
        const last = list[list.length - 1]
        cursor = { created_at: last.created_at, id: last.id }
      }
      return { rows, truncated: true }
    },

    // Exact server-side count (Content-Range), not the length of a capped list.
    async countFieldActivities(businessId, scope = {}) {
      const res = await requestWithCount(buildActivityQuery(businessId, { ...scope, count: true }), { head: true })
      return res && Number.isFinite(res.total) ? res.total : 0
    },

    async getActivityViewers(activityIds) {
      if (!activityIds || activityIds.length === 0) return []
      return request('activity_viewers?activity_id=in.(' + activityIds.join(',') + ')&select=*')
    },

    async getActivityReactions(activityIds) {
      if (!activityIds || activityIds.length === 0) return []
      return request('activity_reactions?activity_id=in.(' + activityIds.join(',') + ')&select=*')
    },

    async getActivityComments(activityIds) {
      if (!activityIds || activityIds.length === 0) return []
      return request('activity_comments?activity_id=in.(' + activityIds.join(',') + ')&order=created_at.asc&select=*')
    },

    async logActivity(activity, viewers) {
      const rows = await request('field_activities', { method: 'POST', body: JSON.stringify(activity) })
      const saved = Array.isArray(rows) ? rows[0] : rows
      if (!saved || !saved.id) throw new Error('Activity was not saved — no id returned.')
      if (viewers && viewers.length > 0) {
        const payload = viewers.map(function (v) { return { ...v, activity_id: saved.id } })
        await request('activity_viewers', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })

        const targets = viewers.map(function (v) { return { staffId: v.staff_id } })
        await notify(
          request,
          activity.business_id,
          targets,
          'activity',
          activity.rep_name + ' logged field activity',
          activity.location_label || null,
          'activity'
        )
      }
      return saved
    },

    async reactToActivity(activityId, staffId, actorName) {
      return request('activity_reactions', { method: 'POST', body: JSON.stringify({
        activity_id: activityId, staff_id: staffId, actor_name: actorName,
      }) })
    },

    async unreactToActivity(reactionId) {
      return request('activity_reactions?id=eq.' + reactionId, { method: 'DELETE', prefer: 'return=minimal' })
    },

    async commentOnActivity(data, businessId, repStaffId) {
      const saved = await request('activity_comments', { method: 'POST', body: JSON.stringify(data) })
      if (businessId && repStaffId && repStaffId !== data.staff_id) {
        await notify(
          request,
          businessId,
          [{ staffId: repStaffId }],
          'activity_comment',
          data.actor_name + ' replied to your activity',
          data.body,
          'activity'
        )
      }
      return saved
    },

    async reverseGeocode(lat, lng) {
      try {
        const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1'
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return null
        const data = await res.json()
        if (!data) return null
        const a = data.address || {}
        const parts = []
        if (a.amenity) parts.push(a.amenity)
        else if (a.building) parts.push(a.building)
        else if (a.shop) parts.push(a.shop)
        if (a.road) parts.push(a.road)
        if (a.suburb) parts.push(a.suburb)
        else if (a.neighbourhood) parts.push(a.neighbourhood)
        if (a.city) parts.push(a.city)
        else if (a.town) parts.push(a.town)
        else if (a.state) parts.push(a.state)
        if (parts.length > 0) return parts.join(', ')
        if (data.display_name) return data.display_name
        return null
      } catch (e) {
        return null
      }
    },

    async uploadActivityVoice(blob) {
      const type = blob.type || 'audio/mp4'
      let ext = 'mp4'
      if (type.indexOf('webm') >= 0) ext = 'webm'
      else if (type.indexOf('ogg') >= 0) ext = 'ogg'
      else if (type.indexOf('aac') >= 0) ext = 'aac'
      else if (type.indexOf('mpeg') >= 0) ext = 'mp3'
      const path = 'voice-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '.' + ext
      return sbUpload('activity-voice', path, blob, type, 'Voice upload failed')
    },
  }
}

export const liveActivityRepository = createLiveActivityRepository()
