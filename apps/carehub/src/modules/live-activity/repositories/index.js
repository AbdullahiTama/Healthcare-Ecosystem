import { sbFetch, sbUpload } from '../../../services/supabase'

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

export function createLiveActivityRepository({ request = sbFetch } = {}) {
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

    async getFieldActivities(businessId, { limit = 100 } = {}) {
      return request('field_activities?business_id=eq.' + businessId + '&order=created_at.desc&select=*&limit=' + limit)
    },

    async countFieldActivities(businessId, staffId) {
      let path = 'field_activities?business_id=eq.' + businessId
      if (staffId) path += '&staff_id=eq.' + staffId
      const rows = await request(path + '&select=id&limit=1000')
      return Array.isArray(rows) ? rows.length : 0
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
