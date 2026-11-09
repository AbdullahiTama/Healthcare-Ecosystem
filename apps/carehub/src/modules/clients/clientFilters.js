// The Clients page filter: which clients a combination of filters leaves, what each one still owes, and the totals for
// the clients shown. Pure, so the page and its tests share one definition.
import { ALL_TIME, periodBounds } from '../../lib/datePeriods'
import { normText, matchesText, inAmountRange, inPeriod, isAmountRangeSet, amountRangeLabel } from '../../lib/recordFilters'

export const CLIENT_PAYMENT_STATUSES = [['owes', 'Owes money'], ['clear', 'Nothing owed']]
export const CLIENT_ACTIVITY = [['active', 'Has bought before'], ['never', 'Never bought']]
export const GENDERS = [['Male', 'Male'], ['Female', 'Female'], ['Other', 'Other'], ['__none', 'Not recorded']]

export const DEFAULT_CLIENT_FILTERS = Object.freeze({
  search: '', period: ALL_TIME, gender: '', paymentStatus: '', activity: '',
  spend: Object.freeze({ min: '', max: '' }), visits: Object.freeze({ min: '', max: '' }),
})

const toKobo = (n) => Math.round((Number(n) || 0) * 100)

// What each client owes the business: the outstanding balance of their open "owed to us" debts. A debt is theirs by
// its client link; a debt without one is theirs only when its name matches exactly one client (case and spacing
// ignored), the same rule the till uses to link a typed name. Returns Map(clientId → naira).
export function clientBalances(clients, debts) {
  const byName = new Map()
  for (const c of clients || []) {
    const k = normText(c.full_name)
    if (!k) continue
    byName.set(k, byName.has(k) ? null : c.id) // null: two clients share the name, never guess
  }
  const kobo = new Map()
  for (const d of debts || []) {
    if (d.direction !== 'owes_us' || d.status === 'paid') continue
    const bal = toKobo(d.balance)
    if (bal <= 0) continue
    const id = d.client_id || byName.get(normText(d.party_name))
    if (!id) continue
    kobo.set(id, (kobo.get(id) || 0) + bal)
  }
  return new Map([...kobo].map(([id, k]) => [id, k / 100]))
}

export function filterClients(clients, filters, balances = new Map()) {
  const f = { ...DEFAULT_CLIENT_FILTERS, ...filters }
  const bounds = periodBounds(f.period)
  return (clients || []).filter((c) => {
    const owed = balances.get(c.id) || 0
    const visits = Number(c.visit_count) || 0
    return matchesText([c.full_name, c.phone, c.email, c.address], f.search) &&
      inPeriod(c.created_at, bounds) &&
      (!f.gender || (f.gender === '__none' ? !c.gender : normText(c.gender) === normText(f.gender))) &&
      (!f.paymentStatus || (f.paymentStatus === 'owes' ? owed > 0 : owed <= 0)) &&
      (!f.activity || (f.activity === 'active' ? visits > 0 : visits === 0)) &&
      inAmountRange(c.total_spend, f.spend) &&
      inAmountRange(visits, f.visits)
  })
}

// Totals for the clients shown: how many, their lifetime spend and visits, and what they still owe.
export function clientTotals(clients, balances = new Map()) {
  let spend = 0
  let owed = 0
  let visits = 0
  let owing = 0
  for (const c of clients || []) {
    spend += toKobo(c.total_spend)
    visits += Number(c.visit_count) || 0
    const o = toKobo(balances.get(c.id))
    owed += o
    if (o > 0) owing++
  }
  const count = (clients || []).length
  return { count, spend: spend / 100, owed: owed / 100, owing, visits, averageSpend: count ? Math.round(spend / count) / 100 : 0 }
}

export function activeClientFilterCount(filters) {
  const f = { ...DEFAULT_CLIENT_FILTERS, ...filters }
  const b = periodBounds(f.period)
  return [!!f.search.trim(), !!(b.from || b.to), !!f.gender, !!f.paymentStatus, !!f.activity, isAmountRangeSet(f.spend), isAmountRangeSet(f.visits)]
    .filter(Boolean).length
}

const labelOf = (pairs, v) => (pairs.find(([k]) => k === v) || [])[1]

export function describeClientFilters(filters, { fmt } = {}) {
  const f = { ...DEFAULT_CLIENT_FILTERS, ...filters }
  const b = periodBounds(f.period)
  const spend = fmt ? amountRangeLabel(f.spend, fmt) : ''
  const visits = amountRangeLabel(f.visits, String)
  return [
    f.search.trim() && `"${f.search.trim()}"`,
    (b.from || b.to) && `joined ${b.label}`,
    f.gender && (f.gender === '__none' ? 'gender not recorded' : f.gender),
    labelOf(CLIENT_PAYMENT_STATUSES, f.paymentStatus),
    labelOf(CLIENT_ACTIVITY, f.activity),
    spend && `spent ${spend}`,
    visits && `${visits} visits`,
  ].filter(Boolean).join(' · ')
}
