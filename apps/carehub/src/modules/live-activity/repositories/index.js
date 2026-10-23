import { sbFetch, sbFetchWithCount, sbUpload, sbSignUrl } from '../../../services/supabase'
import { newActivityId } from '../activityId'
import { lookupArea } from '../areaLookup'
import { VOICE_BUCKET, voicePathFromUrl, voiceUploadInfo } from '../voiceUrl'

// Did the database REFUSE this write (a policy or a missing grant), as opposed to
// the request failing in transit? A refusal will be refused again, so retrying it
// is pointless; a network or server failure is worth retrying.
export function isPermissionRefusal(error) {
  const text = String(error && error.message ? error.message : error)
  return /\((401|403)\)|42501|row-level security|permission denied/i.test(text)
}

// Internal notify helper: one notification row per recipient. Returns
//   'sent'     they were written (or there was nobody to tell)
//   'refused'  the database policy does not let this caller write them
//   'failed'   the request failed (network, server); worth trying again
// It never throws: a failed notification must not break the action that triggered
// it, but it must not be invisible either.
async function notify(request, businessId, recipients, kind, title, body, link) {
  try {
    if (!recipients || recipients.length === 0) return 'sent'
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
    return 'sent'
  } catch (e) {
    console.error('Notification failed:', e)
    return isPermissionRefusal(e) ? 'refused' : 'failed'
  }
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

const SIGNED_LINK_SECONDS = 3600
const SIGNED_LINK_REUSE_MS = 50 * 60 * 1000

export function createLiveActivityRepository({
  request = sbFetch,
  requestWithCount = sbFetchWithCount,
  upload = sbUpload,
  signUrl = sbSignUrl,
  now = Date.now,
  randomSuffix = function () { return Math.random().toString(36).slice(2, 8) },
} = {}) {
  // Signed playback links by stored URL: { promise, at }. In flight requests are shared;
  // a failure is dropped so the next try asks again.
  const signedLinks = new Map()

  // Tell the people a report was shared with: 'sent', 'refused' or 'failed' (see notify).
  function notifyViewers(activity, viewers) {
    return notify(
      request,
      activity.business_id,
      (viewers || []).map(function (v) { return { staffId: v.staff_id } }),
      'activity',
      activity.rep_name + ' logged field activity',
      activity.location_label || null,
      'activity'
    )
  }

  // Does this error mean "the project has not deployed log_field_activity"? Only that answers a
  // fallback; every other failure (a refusal, a dropped connection) stays a failure.
  function isMissingFunction(e) {
    const text = String(e && e.message ? e.message : e)
    return /log_field_activity/.test(text) && /PGRST202|Could not find the function|\(404\)/i.test(text)
  }
  // Set once the project is seen not to have the function, so the page asks one time, not on every save.
  let oneStepUnavailable = false

  // The original route: the activity under its id with ignore-duplicates, then only the viewers not already
  // there, then the alerts. Two transactions, but safe to repeat.
  async function saveInTwoSteps(activity, viewers) {
    const id = activity.id
    // This route is only taken by a project that lacks log_field_activity, which also lacks the columns added
    // after it (gps_accuracy_m): posting an unknown column would fail the whole save, so they are left out.
    const { gps_accuracy_m: _accuracy, ...row } = activity
    await request('field_activities', {
      method: 'POST',
      body: JSON.stringify(row),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    })
    const result = { id, notification: 'none' }
    if (viewers.length > 0) {
      const existing = await request('activity_viewers?activity_id=eq.' + id + '&select=staff_id')
      const have = new Set((Array.isArray(existing) ? existing : []).map(function (v) { return v.staff_id }))
      const missing = viewers.filter(function (v) { return !have.has(v.staff_id) })
      if (missing.length > 0) {
        const payload = missing.map(function (v) { return { ...v, activity_id: id } })
        await request('activity_viewers', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' })
        result.notification = await notifyViewers(activity, missing)
      }
    }
    return result
  }

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

    // Saves a report and tells the people it is shared with, safely to repeat.
    //
    // First choice: ONE request to log_field_activity (carehub_20261020_log_field_activity, a draft until
    // approved), which saves the report and its viewers in a single transaction, so a tagged person already
    // has access when the report becomes visible. If the project does not have the function yet, the
    // two-request route is used instead (and remembered). Any other failure is a failure, never a reason to
    // switch routes: a retry must take the same idempotent route as the first attempt.
    //
    // Either way: the same id twice is one report, only viewers not already present are added, and a
    // notification problem never fails the save. It is reported as notification: 'sent', 'none',
    // 'failed' (worth a retry through notifyViewers) or 'refused' (the database does not allow it).
    async logActivity(activity, viewers) {
      const full = { ...activity, id: activity.id || newActivityId() }
      const shared = viewers || []
      if (!oneStepUnavailable) {
        try {
          const out = await request('rpc/log_field_activity', {
            method: 'POST',
            body: JSON.stringify({ p_activity: full, p_viewers: shared }),
          })
          const info = out && typeof out === 'object' && !Array.isArray(out) ? out : {}
          const result = { id: full.id, notification: 'none' }
          // Alert only people newly added, so a retry that adds nobody alerts nobody. When the database
          // sends the alerts itself (alerts: 'server') the browser sends none.
          if (shared.length > 0 && Number(info.viewers_added) > 0) {
            result.notification = info.alerts === 'server' ? 'sent' : await notifyViewers(full, shared)
          }
          return result
        } catch (e) {
          if (!isMissingFunction(e)) throw e
          oneStepUnavailable = true
        }
      }
      return saveInTwoSteps(full, shared)
    },

    notifyViewers: notifyViewers,

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

    // The area's name for the report caption, throttled and cached (areaLookup.js).
    // Resolves { status: 'ok', label } or { status: 'no_result' }; rejects when the
    // service cannot be reached, which the page reports differently from "no name".
    lookupArea(lat, lng) {
      return lookupArea(lat, lng)
    },

    // Stores a recording under '<company id>/<report id>-<suffix>.<ext>' and returns its URL, which is
    // what the report keeps. The company folder is what the bucket's upload rule checks.
    async uploadActivityVoice(blob, { businessId, activityId } = {}) {
      const info = voiceUploadInfo(blob, businessId, activityId, randomSuffix())
      return upload(VOICE_BUCKET, info.path, blob, info.contentType, 'Voice upload failed')
    },

    // A link to play a stored voice note. The stored URL is only used to find the file's path, so this
    // works whether the bucket is public (today) or private (after carehub_20261020_activity_voice_private).
    // If signing fails it returns the stored URL, which still plays while the bucket is public.
    async signedVoiceUrl(storedUrl) {
      const path = voicePathFromUrl(storedUrl)
      if (!path) return storedUrl
      const cached = signedLinks.get(storedUrl)
      if (cached && now() - cached.at < SIGNED_LINK_REUSE_MS) return cached.promise
      const promise = Promise.resolve(signUrl(VOICE_BUCKET, path, SIGNED_LINK_SECONDS)).catch(function (e) {
        signedLinks.delete(storedUrl)
        console.error('Could not sign the voice note link:', e)
        return storedUrl
      })
      signedLinks.set(storedUrl, { promise: promise, at: now() })
      const link = await promise
      if (link === storedUrl) signedLinks.delete(storedUrl)
      return link
    },
  }
}

export const liveActivityRepository = createLiveActivityRepository()
