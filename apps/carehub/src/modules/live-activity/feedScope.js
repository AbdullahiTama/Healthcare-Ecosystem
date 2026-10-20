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

// The server-side narrowing for a tab, so a busy team's latest page is not
// mostly other people's reports. Row level security still applies on top.
export function scopeQuery(scope, { canSeeAll, meStaffId }) {
  if (scope === 'mine') return meStaffId ? { staffId: meStaffId } : { ownerOnly: true }
  if (canSeeAll) return {}
  return meStaffId ? { excludeStaffId: meStaffId } : {}
}

function startOfWeek(d) {
  const x = new Date(d)
  const diff = x.getDay() === 0 ? 6 : x.getDay() - 1
  x.setDate(x.getDate() - diff)
  x.setHours(0, 0, 0, 0)
  return x
}

// The [since, until] window for a date filter, as Dates (null = open ended).
// One definition for the on-screen filter and the export, so they cannot differ.
export function dateWindow(range, customFrom = '', customTo = '', now = new Date()) {
  const day = (y, m, d) => new Date(y, m, d, 0, 0, 0, 0)
  if (range === 'today') return { since: day(now.getFullYear(), now.getMonth(), now.getDate()), until: null }
  if (range === 'week') return { since: startOfWeek(now), until: null }
  if (range === 'lastweek') {
    const thisWeek = startOfWeek(now)
    const lastWeek = new Date(thisWeek)
    lastWeek.setDate(lastWeek.getDate() - 7)
    return { since: lastWeek, until: new Date(thisWeek.getTime() - 1) }
  }
  if (range === 'month') return { since: day(now.getFullYear(), now.getMonth(), 1), until: null }
  if (range === 'year') return { since: day(now.getFullYear(), 0, 1), until: null }
  if (range === 'custom') {
    const from = customFrom ? new Date(customFrom) : null
    if (from) from.setHours(0, 0, 0, 0)
    const to = customTo ? new Date(customTo) : null
    if (to) to.setHours(23, 59, 59, 999)
    return { since: from, until: to }
  }
  return { since: null, until: null }
}

export function inWindow(dateStr, win) {
  const d = new Date(dateStr)
  if (win.since && d < win.since) return false
  if (win.until && d > win.until) return false
  return true
}
