// Where a business stands with its CareHub plan, and what that allows.
//
import { isManagerRole } from './permissions'

// The database decides (business_plan_status, carehub_20261214_plan_enforcement): it knows when enforcement started,
// which gives businesses that were already expired a fresh 7-day grace. These helpers turn its answer into what the
// screens show. When the database does not have that function yet, the state is estimated from the expiry date and
// nothing is restricted, matching the database, which restricts nothing until the update is applied.
//
//   active      more than 14 days left (or no expiry recorded)
//   expiring    14 days or fewer left
//   grace       expired, within the 7-day grace period: full access, daily alerts
//   restricted  after the grace period: records stay readable and the POS keeps selling, but no new staff, branches or
//               products, no imports and no exports until the plan is renewed

export const NOTICE_DAYS = 14
export const GRACE_DAYS = 7
const DAY = 86400000

// Whole days from now until `date` (negative once it has passed), counted the way people do: "expires in 1 day" on
// the day before.
export function daysUntil(date, now = new Date()) {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - now.getTime()) / DAY)
}

// The normalised status from business_plan_status's JSON.
export function fromServer(json, now = new Date()) {
  if (!json) return null
  return {
    plan: json.plan || 'basic',
    state: json.state,
    expiresAt: json.expires_at || null,
    graceEndsAt: json.grace_ends_at || null,
    daysLeft: daysUntil(json.expires_at, now),
    graceDaysLeft: daysUntil(json.grace_ends_at, now),
    limits: json.limits || {},
    enforced: true,
  }
}

// An estimate from the business row alone, used only while business_plan_status is not deployed. Never restricted.
export function estimateFromBrand(brand, now = new Date()) {
  const expiresAt = brand?.plan_expires_at || null
  const daysLeft = daysUntil(expiresAt, now)
  const state = daysLeft == null || daysLeft > NOTICE_DAYS ? 'active' : daysLeft > 0 ? 'expiring' : 'grace'
  return { plan: brand?.plan || 'basic', state, expiresAt, graceEndsAt: null, daysLeft, graceDaysLeft: null, limits: {}, enforced: false }
}

export const isRestricted = (status) => status?.state === 'restricted'

// Who is told about the plan: the owner and managers (staff without a manager role cannot renew, and never see
// billing).
export function seesPlanAlerts(role) {
  return role === 'Owner' || isManagerRole(role)
}

// The sentence shown when an action is paused by an expired plan. `what` is what they tried to add or do.
export function restrictedMessage(what) {
  return `Your CareHub plan has expired, so ${what} is paused. Renew it in Settings to continue. Sales and your records are not affected.`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// The banner line for a status, or null when there is nothing to say.
export function bannerText(status) {
  if (!status) return null
  const { state, daysLeft, graceDaysLeft, graceEndsAt } = status
  if (state === 'expiring') {
    return daysLeft <= 0 ? 'Your plan expires today. Renew now to keep full access.' : `Your plan expires in ${plural(daysLeft, 'day')}. Renew now to keep full access.`
  }
  if (state === 'grace') {
    const ago = daysLeft != null && daysLeft < 0 ? `expired ${plural(-daysLeft, 'day')} ago` : 'has expired'
    if (!status.enforced || graceEndsAt == null) return `Your plan ${ago}. Renew now to avoid interruptions.`
    return graceDaysLeft > 1
      ? `Your plan ${ago}. Renew within ${plural(graceDaysLeft, 'day')} (by ${dateText(graceEndsAt)}) to avoid restrictions.`
      : `Your plan ${ago}. Restrictions start ${graceDaysLeft === 1 ? 'tomorrow' : 'today'} unless you renew.`
  }
  if (state === 'restricted') {
    return 'Your plan has expired and some features are paused. Sales and your records are not affected.'
  }
  return null
}

// Whether the once-a-day popup applies: the last 7 days before expiry, the grace period, and while restricted.
export function wantsDailyNotice(status) {
  if (!status) return false
  if (status.state === 'grace' || status.state === 'restricted') return true
  return status.state === 'expiring' && status.daysLeft != null && status.daysLeft <= GRACE_DAYS
}
