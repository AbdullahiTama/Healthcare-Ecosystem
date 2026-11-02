// Subscription administration — the rules the Money > Subscriptions screen applies, kept out of the component.
//
// The database decides (admin_manage_subscription, carehub_20261230_admin_subscription_management): it validates
// every request, records the history and the audit row, and is the security boundary. These helpers give the screen
// labels, filters, quick validation (so obvious mistakes are caught before a round trip) and export columns.

import { PLAN_LABELS } from '../../../lib/planLimits'

const DAY = 86400000

// Plans an administrator can put a business on. 'hospital' is a legacy value that is still read but not offered.
export const PLAN_OPTIONS = ['basic', 'growth', 'premium', 'enterprise', 'custom'].map(key => ({ value: key, label: PLAN_LABELS[key] }))
export const planLabel = (key) => PLAN_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Basic')

export const ACTIONS = {
  change_plan: { label: 'Change plan', help: 'Upgrade or change the plan. The expiry date stays the same.' },
  grant: { label: 'Grant free access', help: 'Free or complimentary time, added after any time already paid for. No payment or receipt is recorded.' },
  extend: { label: 'Extend', help: 'Add time after the current expiry date (or from today if it has passed).' },
  set_expiry: { label: 'Set expiry date', help: 'Correct the expiry date to an exact day.' },
  suspend: { label: 'Suspend', help: 'Pause the plan now: records stay readable and sales continue, but new staff, branches, products, imports and exports are paused. The time left is given back on activation. To block all access, suspend the business itself under Businesses.' },
  activate: { label: 'Activate', help: 'Lift the suspension and give back the time that was left when it was suspended.' },
}

export const GRANT_TYPES = [
  { value: 'trial', label: 'Free trial' },
  { value: 'complimentary', label: 'Complimentary' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'contribution', label: 'Contribution' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'other', label: 'Other arrangement' },
]
const GRANT_LABELS = Object.fromEntries(GRANT_TYPES.map(g => [g.value, g.label]))

export const DURATION_PRESETS = [
  { value: 'm1', label: '1 month', months: 1 },
  { value: 'm3', label: '3 months', months: 3 },
  { value: 'm6', label: '6 months', months: 6 },
  { value: 'm12', label: '1 year', months: 12 },
  { value: 'm24', label: '2 years', months: 24 },
  { value: 'days', label: 'Custom number of days' },
]

export const STATE_META = {
  active: { label: 'Active', tone: 'green' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  grace: { label: 'Expired (grace period)', tone: 'amber' },
  restricted: { label: 'Restricted', tone: 'red' },
}
export const stateLabel = (state) => (STATE_META[state] || { label: state || 'Unknown' }).label

const ACCESS_LABELS = {
  paid: 'Paid',
  none: 'Signup period (never paid)',
  admin: 'Set by an administrator',
  suspended: 'Suspended',
  ...GRANT_LABELS,
}
export const accessLabel = (type) => ACCESS_LABELS[type] || 'Unknown'
export const isComplimentary = (type) => Object.prototype.hasOwnProperty.call(GRANT_LABELS, type)

// The one-line "payment status" an administrator scans for.
export function paymentStatus(row) {
  if (!row) return { label: 'Unknown', tone: 'gray' }
  if (row.suspended) return { label: 'Suspended', tone: 'red' }
  if (row.plan_state === 'restricted') return { label: 'Overdue — restricted', tone: 'red' }
  if (row.plan_state === 'grace') return { label: 'Overdue — in grace', tone: 'amber' }
  if (row.access_type === 'paid') return { label: row.plan_state === 'expiring' ? 'Paid — renewal due' : 'Paid', tone: row.plan_state === 'expiring' ? 'amber' : 'green' }
  if (isComplimentary(row.access_type)) return { label: accessLabel(row.access_type), tone: 'blue' }
  if (row.access_type === 'admin') return { label: 'Set by admin', tone: 'blue' }
  return { label: 'Not paid yet', tone: 'gray' }
}

export function daysLeft(expiresAt, now = new Date()) {
  if (!expiresAt) return null
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY)
}

// Which actions make sense for this subscription right now. The database refuses the others anyway.
export function availableActions(row) {
  if (!row) return []
  if (row.suspended) return ['activate', 'change_plan']
  const list = ['change_plan', 'grant', 'extend', 'set_expiry', 'suspend']
  return row.expires_at ? list : list.filter(a => a !== 'grant' && a !== 'extend')
}

export const emptyForm = (action = 'change_plan', row = null) => ({
  action,
  plan: '',
  duration: 'm1',
  days: '',
  grantType: 'trial',
  expiresOn: row?.expires_at ? String(row.expires_at).slice(0, 10) : '',
  reason: '',
})

function durationOf(form) {
  if (form.duration === 'days') {
    const n = Number(form.days)
    return Number.isInteger(n) ? { months: null, days: n } : { months: null, days: NaN }
  }
  const preset = DURATION_PRESETS.find(p => p.value === form.duration)
  return { months: preset?.months ?? NaN, days: null }
}

// A first check before sending; null when the form looks complete. Mirrors the database rules.
export function validateForm(form, row) {
  if (!row) return 'Choose a business.'
  if (!availableActions(row).includes(form.action)) return 'That change is not available for this subscription right now.'
  const reason = (form.reason || '').trim()
  if (reason.length < 3) return 'Give a reason for this change (at least 3 characters).'
  if (reason.length > 500) return 'Keep the reason under 500 characters.'
  if (form.action === 'change_plan') {
    if (!form.plan) return 'Choose a plan.'
    if (form.plan === row.plan) return 'The business is already on this plan.'
  }
  if (form.action === 'grant' && !GRANT_TYPES.some(g => g.value === form.grantType)) return 'Choose the kind of access being granted.'
  if (form.action === 'grant' || form.action === 'extend') {
    const { months, days } = durationOf(form)
    if (form.duration === 'days' && !(days >= 1 && days <= 3650)) return 'Days must be a whole number between 1 and 3650.'
    if (form.duration !== 'days' && !(months >= 1 && months <= 120)) return 'Choose how long.'
  }
  if (form.action === 'set_expiry') {
    if (!form.expiresOn || Number.isNaN(new Date(form.expiresOn).getTime())) return 'Choose the new expiry date.'
  }
  return null
}

// The manageSubscription() arguments for a valid form.
export function buildRequest(form, row) {
  const base = { businessId: row.business_id, action: form.action, reason: form.reason.trim() }
  if (form.action === 'change_plan') return { ...base, plan: form.plan }
  if (form.action === 'grant' || form.action === 'extend') {
    const { months, days } = durationOf(form)
    return { ...base, months, days, ...(form.action === 'grant' ? { grantType: form.grantType, plan: form.plan || null } : {}) }
  }
  // End of the chosen day in Lagos (UTC+1, no daylight saving), so "expires on 31 Dec" means all of 31 Dec.
  if (form.action === 'set_expiry') return { ...base, expiresAt: `${form.expiresOn}T23:59:59+01:00` }
  return base
}

// What the expiry will become, for the confirmation line. Null when it cannot be known here (activate).
export function previewExpiry(form, row, now = new Date()) {
  if (!row) return null
  if (form.action === 'set_expiry') return form.expiresOn ? new Date(`${form.expiresOn}T23:59:59+01:00`) : null
  if (form.action !== 'grant' && form.action !== 'extend') return null
  if (!row.expires_at) return null
  const { months, days } = durationOf(form)
  const current = new Date(row.expires_at)
  const base = new Date(Math.max(current.getTime(), now.getTime()))
  if (days) return new Date(base.getTime() + days * DAY)
  if (!months) return null
  const d = new Date(base)
  d.setMonth(d.getMonth() + months)
  return d
}

// Turns a transport error into the sentence the database meant.
export function readableError(e) {
  const raw = String(e?.message || e || '')
  if (/PGRST202|Could not find the function|\(404\)/i.test(raw)) {
    return 'Subscription management is not switched on yet: the database update carehub_20261230_admin_subscription_management has not been applied.'
  }
  if (/\((401|403)\)|platform administrator|42501/i.test(raw)) return 'Only a platform administrator can manage subscriptions.'
  return raw.replace(/^Supabase error \(\d+\):\s*/, '') || 'Something went wrong. Nothing was changed.'
}

export function summarize(rows, now = new Date()) {
  const list = rows || []
  return {
    total: list.length,
    active: list.filter(r => r.plan_state === 'active' && !r.suspended).length,
    expiring: list.filter(r => r.plan_state === 'expiring' && !r.suspended).length,
    overdue: list.filter(r => (r.plan_state === 'grace' || r.plan_state === 'restricted') && !r.suspended).length,
    complimentary: list.filter(r => isComplimentary(r.access_type)).length,
    suspended: list.filter(r => r.suspended).length,
    expiringIn30: list.filter(r => { const d = daysLeft(r.expires_at, now); return d != null && d >= 0 && d <= 30 }).length,
  }
}

export function filterRows(rows, { search = '', state = '', plan = '', access = '' } = {}) {
  const q = search.trim().toLowerCase()
  return (rows || []).filter(r => {
    if (state === 'suspended') { if (!r.suspended) return false } else if (state && (r.plan_state !== state || r.suspended)) return false
    if (plan && r.plan !== plan) return false
    if (access === 'complimentary') { if (!isComplimentary(r.access_type)) return false } else if (access && r.access_type !== access) return false
    if (!q) return true
    return [r.name, r.owner_name, r.email, r.phone, r.state, r.city, r.business_id].some(v => String(v || '').toLowerCase().includes(q))
  })
}

const isoDay = (d) => (d ? String(d).slice(0, 10) : '')

export const SUBSCRIPTION_EXPORT_COLUMNS = [
  { label: 'Business', key: 'name' },
  { label: 'Business ID', key: 'business_id' },
  { label: 'Owner', key: 'owner_name' },
  { label: 'Email', key: 'email' },
  { label: 'Phone', key: 'phone' },
  { label: 'State', key: 'state' },
  { label: 'Business status', key: 'status' },
  { label: 'Plan', get: r => planLabel(r.plan) },
  { label: 'Subscription state', get: r => (r.suspended ? 'Suspended' : stateLabel(r.plan_state)) },
  { label: 'Payment status', get: r => paymentStatus(r).label },
  { label: 'Access type', get: r => accessLabel(r.access_type) },
  { label: 'Current period start', get: r => isoDay(r.period_start) },
  { label: 'Expiry date', get: r => isoDay(r.expires_at) },
  { label: 'Grace ends', get: r => isoDay(r.grace_ends_at) },
  { label: 'Days left', get: r => daysLeft(r.expires_at) ?? '' },
  { label: 'Payments', key: 'payment_count' },
  { label: 'Total paid (NGN)', key: 'total_paid' },
  { label: 'Last payment date', get: r => isoDay(r.last_payment_at) },
  { label: 'Last payment (NGN)', key: 'last_payment_amount' },
  { label: 'Last payment method', key: 'last_payment_method' },
  { label: 'Branches', key: 'branch_count' },
  { label: 'Last admin change', get: r => (r.last_event_action ? ACTIONS[r.last_event_action]?.label || r.last_event_action : '') },
  { label: 'Last admin change date', get: r => isoDay(r.last_event_at) },
  { label: 'Customer since', get: r => isoDay(r.created_at) },
]

// A history entry as one readable line.
export function describeHistory(h) {
  if (h.kind === 'payment') {
    const months = h.months ? `${h.months} month${h.months === 1 ? '' : 's'}` : ''
    return `Payment${h.payment_method ? ` (${h.payment_method})` : ''}${months ? ` for ${months}` : ''} of ${planLabel(h.plan_after)}`
  }
  const action = ACTIONS[h.action]?.label || h.action
  if (h.action === 'change_plan') return `Plan changed from ${planLabel(h.plan_before)} to ${planLabel(h.plan_after)}`
  if (h.action === 'grant') {
    const len = h.months ? `${h.months} month${h.months === 1 ? '' : 's'}` : `${h.days} day${h.days === 1 ? '' : 's'}`
    const planChange = h.plan_before !== h.plan_after ? ` on ${planLabel(h.plan_after)}` : ''
    return `${GRANT_LABELS[h.grant_type] || 'Free'} access granted: ${len}${planChange}`
  }
  if (h.action === 'extend') return `Extended by ${h.months ? `${h.months} month${h.months === 1 ? '' : 's'}` : `${h.days} day${h.days === 1 ? '' : 's'}`}`
  if (h.action === 'set_expiry') return 'Expiry date changed'
  return action
}

export const HISTORY_EXPORT_COLUMNS = [
  { label: 'Date', get: h => h.occurred_at || '' },
  { label: 'Type', get: h => (h.kind === 'payment' ? 'Payment' : 'Admin change') },
  { label: 'Description', get: describeHistory },
  { label: 'Plan before', key: 'plan_before' },
  { label: 'Plan after', key: 'plan_after' },
  { label: 'Expiry / period start', get: h => h.expires_before || '' },
  { label: 'Expiry / period end', get: h => h.expires_after || '' },
  { label: 'Amount (NGN)', key: 'amount' },
  { label: 'Method', key: 'payment_method' },
  { label: 'Reference', key: 'reference' },
  { label: 'Receipt', key: 'receipt_number' },
  { label: 'Reason', key: 'reason' },
  { label: 'By', key: 'actor_email' },
]
