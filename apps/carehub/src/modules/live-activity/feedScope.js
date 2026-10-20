// Which loaded activities belong under each feed tab. Pure, so the role matrix
// is unit-tested. This is presentation only: the database RESTRICTIVE select
// policy decides what a person may read, and every row passed in here has
// already survived it. Notification subscription is a separate concept: being
// tagged as a viewer grants access to one report, it is not a visibility switch
// for a manager.
//
//   mine  : reports the person wrote.
//   team  : everything their permissions let them read (see-all roles), or,
//           for everyone else, reports colleagues shared with them.

export function isOwnActivity(activity, meStaffId) {
  return activity.staff_id === meStaffId
}

export function isTaggedActivity(activity, meStaffId, viewersByAct) {
  if (meStaffId == null) return false
  return (viewersByAct[activity.id] || []).some(function (v) { return v.staff_id === meStaffId })
}

export function filterByScope(activities, { scope, canSeeAll, meStaffId, viewersByAct = {} }) {
  return activities.filter(function (a) {
    if (scope === 'mine') return isOwnActivity(a, meStaffId)
    if (canSeeAll) return true
    return !isOwnActivity(a, meStaffId) && isTaggedActivity(a, meStaffId, viewersByAct)
  })
}

export function scopeTabs(canSeeAll) {
  return [
    ['mine', 'My Feed'],
    ['team', canSeeAll ? 'Team Reports' : 'Shared with me'],
  ]
}
