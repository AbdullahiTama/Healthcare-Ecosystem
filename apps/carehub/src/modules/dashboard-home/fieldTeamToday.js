import { getNavItems, getPerms, canSeeAllActivity } from '../../lib/permissions'
import { STALE_AFTER_MINUTES } from '../checkins/checkinView'
import { targetLabel, storedVerification } from '../live-activity/activityTarget'

// What "Field team today" shows on the company dashboard (layout A): who checked in, and today's visits.
// Pure, so the counting rules are tested on their own.
//
//   checkins       rows of manager_checkin_overview (active staff, each with role and last_checkin)
//   visits         field reports since the start of today (any order)
//   ordersAwaiting orders waiting for this person's approval
//   placesPending  rep-added places awaiting review
//   customers      rows of field_customers (places the team visited); quietCustomers = last visited over 30 days ago
//
// A rep is an active staff member whose menu includes Field and who is not a field manager; the owner has no
// staff row and is never counted. "Checked in" means a captured check-in since local midnight whose latest event is
// not a check-out; a rep who checked out today has finished for the day (checkedOut), which is neither checked in
// nor missing, and their position is not "old" because they are no longer working.

const MAX_VISIT_ROWS = 8
const QUIET_AFTER_DAYS = 30

function startOfDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function isRep(role, businessType, customRoles) {
  const hasField = getNavItems(role, businessType, customRoles).some((i) => i[0] === 'activity')
  return hasField && !canSeeAllActivity({ role, perms: getPerms(role, customRoles) })
}

export function summariseFieldDay({ checkins = [], visits = [], ordersAwaiting = [], placesPending = [], customers = [], now = Date.now(), businessType, customRoles = {} } = {}) {
  const dayStart = startOfDay(now)

  const checkinRows = (checkins || [])
    .filter((p) => isRep(p.role, businessType, customRoles))
    .map((p) => {
      const at = p.last_checkin ? Date.parse(p.last_checkin.at) : NaN
      const today = Number.isFinite(at) && at >= dayStart
      const checkedOut = today && p.last_checkin.event_type === 'workday_checkout'
      return {
        staffId: p.staff_id,
        name: p.name,
        at: today ? p.last_checkin.at : null,
        area: today ? (p.last_checkin.location_label || '') : '',
        stale: today && !checkedOut && (now - at) / 60000 > STALE_AFTER_MINUTES,
        missing: !today,
        checkedOut,
      }
    })

  const todays = (visits || [])
    .filter((v) => Date.parse(v.created_at) >= dayStart)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

  return {
    checkedIn: checkinRows.filter((r) => !r.missing && !r.checkedOut).length,
    repsTotal: checkinRows.length,
    visitsToday: todays.length,
    ordersToApprove: (ordersAwaiting || []).length,
    placesToConfirm: (placesPending || []).length,
    quietCustomers: (customers || []).filter((c) => Date.parse(c.last_visit_at) < now - QUIET_AFTER_DAYS * 86400000).length,
    checkinRows,
    visitRows: todays.slice(0, MAX_VISIT_ROWS).map((v) => ({
      id: v.id,
      at: v.created_at,
      rep: v.rep_name,
      place: targetLabel(v) || 'No place recorded',
      badge: storedVerification(v),
      hasPhoto: Array.isArray(v.photo_paths) && v.photo_paths.length > 0,
    })),
  }
}
