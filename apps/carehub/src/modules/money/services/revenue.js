// Revenue figures for Money › Revenue, from what actually happened — never from estimates.
//
// Sources (all live, platform-admin readable):
//   * plan_payments with status 'success' — every naira collected for CareHub plans, written only by
//     renew_business_plan (Paystack and wallet settlement, or a renewal recorded by staff). naira_amount is in naira.
//   * admin_subscription_overview() — every main business's plan, state and how its access was obtained.
//   * lib/planLimits.js — the prices checkout charges (initiate-plan-payment reads them). plan_catalog is an unused
//     mirror with different keys and is not used here.
//
// Definitions (shown on the screen next to each figure):
//   collected      money received in the period, by payment date (Lagos calendar: UTC+1, no daylight saving)
//   earning now    for each payment whose paid-for period covers today, amount ÷ months bought; summed. The monthly
//                  revenue the platform is currently earning from money already received. Free access adds nothing.
//   paying         businesses with at least one such payment
//   renewals due   paying businesses whose plan expires in the next 30 days, valued at their last payment
//   lapsed         businesses that have paid before and are now overdue (grace or restricted), valued at last payment

import { PLAN_LABELS, PLAN_YEARLY_NAIRA } from '../../../lib/planLimits'
import { isComplimentary } from './subscriptionAdmin'

const DAY = 86400000
const LAGOS_OFFSET = 3600000 // Africa/Lagos is UTC+1 all year

export const lagosMonthKey = (date) => new Date(new Date(date).getTime() + LAGOS_OFFSET).toISOString().slice(0, 7)
export const monthLabel = (key) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-NG', { month: 'short', year: '2-digit' })

// The paid-for period of a payment. Older rows without one are taken as the months bought from the payment date,
// the same rule the billing migration used for its backfill.
export function paymentPeriod(p) {
  const start = p.period_start ? new Date(p.period_start) : new Date(p.paid_at)
  let end = p.period_end ? new Date(p.period_end) : null
  if (!end) { end = new Date(start); end.setUTCMonth(end.getUTCMonth() + (Number(p.months) || 1)) }
  return { start, end }
}

// The last `count` Lagos calendar months, oldest first, ending with the current one.
export function lastMonths(now = new Date(), count = 12) {
  const [y, m] = lagosMonthKey(now).split('-').map(Number)
  const keys = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys
}

export function computeRevenue({ payments = [], subscriptions = [], now = new Date() } = {}) {
  const paid = (payments || []).filter(p => p && p.status === 'success' && Number(p.naira_amount) > 0)
  const amount = (p) => Number(p.naira_amount) || 0
  const nowMs = now.getTime()
  const thisMonth = lagosMonthKey(now)

  const totalCollected = paid.reduce((s, p) => s + amount(p), 0)
  const last30 = paid.filter(p => nowMs - new Date(p.paid_at).getTime() <= 30 * DAY && new Date(p.paid_at).getTime() <= nowMs)
  const monthPaid = paid.filter(p => lagosMonthKey(p.paid_at) === thisMonth)

  const monthKeys = lastMonths(now, 12)
  const months = monthKeys.map(key => {
    const inMonth = paid.filter(p => lagosMonthKey(p.paid_at) === key)
    return { key, label: monthLabel(key), total: inMonth.reduce((s, p) => s + amount(p), 0), count: inMonth.length }
  })

  // Earning now: each payment's monthly share while its paid-for period covers today.
  const covering = paid.filter(p => { const { start, end } = paymentPeriod(p); return start.getTime() <= nowMs && nowMs < end.getTime() })
  const earningNow = Math.round(covering.reduce((s, p) => s + amount(p) / (Number(p.months) || 1), 0))
  const payingIds = new Set(covering.map(p => p.business_id))
  const arpu = payingIds.size ? Math.round(earningNow / payingIds.size) : 0

  const byMethod = {}
  for (const p of paid) {
    const k = p.payment_method || 'unknown'
    byMethod[k] = byMethod[k] || { method: k, total: 0, count: 0 }
    byMethod[k].total += amount(p); byMethod[k].count += 1
  }

  const subs = subscriptions || []
  const planKeys = Array.from(new Set(['basic', 'growth', 'premium', 'enterprise', 'custom', ...subs.map(s => s.plan || 'basic')]))
  const planMix = planKeys.map(key => {
    const on = subs.filter(s => (s.plan || 'basic') === key)
    return {
      key, label: PLAN_LABELS[key] || key, yearlyPrice: PLAN_YEARLY_NAIRA[key] ?? null,
      businesses: on.length,
      paying: on.filter(s => payingIds.has(s.business_id)).length,
      free: on.filter(s => isComplimentary(s.access_type) && !s.suspended).length,
      overdue: on.filter(s => !s.suspended && (s.plan_state === 'grace' || s.plan_state === 'restricted')).length,
      suspended: on.filter(s => s.suspended).length,
    }
  }).filter(r => r.businesses > 0 || ['basic', 'growth', 'premium', 'enterprise'].includes(r.key))

  const daysLeft = (s) => (s.expires_at ? Math.ceil((new Date(s.expires_at).getTime() - nowMs) / DAY) : null)
  const renewalsDue = subs.filter(s => !s.suspended && Number(s.payment_count) > 0 && daysLeft(s) != null && daysLeft(s) >= 0 && daysLeft(s) <= 30)
  const lapsed = subs.filter(s => !s.suspended && Number(s.payment_count) > 0 && (s.plan_state === 'grace' || s.plan_state === 'restricted'))
  const valueAtLast = (list) => list.reduce((s, x) => s + (Number(x.last_payment_amount) || 0), 0)

  const names = new Map(subs.map(s => [s.business_id, s.name]))
  const recent = [...paid].sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)).slice(0, 10).map(p => ({ ...p, business_name: names.get(p.business_id) || null }))

  return {
    totalCollected, paymentCount: paid.length,
    last30Total: last30.reduce((s, p) => s + amount(p), 0), last30Count: last30.length,
    monthTotal: monthPaid.reduce((s, p) => s + amount(p), 0), monthCount: monthPaid.length,
    months, earningNow, payingCount: payingIds.size, arpu,
    byMethod: Object.values(byMethod).sort((a, b) => b.total - a.total),
    planMix,
    businesses: subs.length,
    freeCount: subs.filter(s => isComplimentary(s.access_type) && !s.suspended).length,
    overdueCount: subs.filter(s => !s.suspended && (s.plan_state === 'grace' || s.plan_state === 'restricted')).length,
    neverPaidCount: subs.filter(s => !(Number(s.payment_count) > 0)).length,
    renewalsDue: { count: renewalsDue.length, value: valueAtLast(renewalsDue), businesses: renewalsDue },
    lapsed: { count: lapsed.length, value: valueAtLast(lapsed), businesses: lapsed },
    recent,
  }
}

export const PAYMENT_EXPORT_COLUMNS = [
  { label: 'Receipt', key: 'receipt_number' },
  { label: 'Paid at', key: 'paid_at' },
  { label: 'Business', get: p => p.business_name || '' },
  { label: 'Business ID', key: 'business_id' },
  { label: 'Plan', get: p => PLAN_LABELS[p.plan] || p.plan || '' },
  { label: 'Months', key: 'months' },
  { label: 'Amount (NGN)', key: 'naira_amount' },
  { label: 'Method', key: 'payment_method' },
  { label: 'Period start', key: 'period_start' },
  { label: 'Period end', key: 'period_end' },
  { label: 'Reference', key: 'reference' },
  { label: 'Provider transaction', key: 'provider_transaction_id' },
]
