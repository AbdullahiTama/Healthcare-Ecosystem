// The Clients page filter: which clients a combination of filters leaves, what each one still owes, and the totals for
// the clients shown. Pure, so the page and its tests share one definition.
import { ALL_TIME, periodBounds } from '../../lib/datePeriods'
import { normText, matchesText, inAmountRange, inPeriod, isAmountRangeSet, amountRangeLabel } from '../../lib/recordFilters'

// A client's financial position (clientPositions): the labels used on every client screen.
export const CLIENT_PAYMENT_STATUSES = [['owes', 'Client owes us'], ['credit', 'We owe client'], ['clear', 'Settled']]
export const CLIENT_ACTIVITY = [['active', 'Has bought before'], ['never', 'Never bought']]
export const GENDERS = [['Male', 'Male'], ['Female', 'Female'], ['Other', 'Other'], ['__none', 'Not recorded']]

export const DEFAULT_CLIENT_FILTERS = Object.freeze({
  search: '', period: ALL_TIME, gender: '', paymentStatus: '', activity: '',
  spend: Object.freeze({ min: '', max: '' }), visits: Object.freeze({ min: '', max: '' }),
})

const toKobo = (n) => Math.round((Number(n) || 0) * 100)

// Each client's financial position, from their open debts (the records Debt Management shows, so the two always agree):
//   owes    what the client owes: open "owed to us" debts (credit sales, opening balances, debts recorded by hand).
//           A debt is theirs by its client link; one without a link is theirs only when its name matches exactly one
//           client (case and spacing ignored), the rule the till uses to link a typed name.
//   credit  what the business owes the client: open "we owe" debts LINKED to the client (an opening balance in the
//           client's favour). Never matched by name: a supplier may share a client's name.
//   net     owes − credit. Positive: "Client owes us"; negative: "We owe client"; zero: settled.
// Returns Map(clientId → { owes, credit, net }) in naira; clients with nothing open are absent.
export function clientPositions(clients, debts) {
  const byName = new Map()
  for (const c of clients || []) {
    const k = normText(c.full_name)
    if (!k) continue
    byName.set(k, byName.has(k) ? null : c.id) // null: two clients share the name, never guess
  }
  const owes = new Map()
  const credit = new Map()
  for (const d of debts || []) {
    if (d.status === 'paid') continue
    const bal = toKobo(d.balance)
    if (bal <= 0) continue
    if (d.direction === 'owes_us') {
      const id = d.client_id || byName.get(normText(d.party_name))
      if (id) owes.set(id, (owes.get(id) || 0) + bal)
    } else if (d.direction === 'we_owe' && d.client_id) {
      credit.set(d.client_id, (credit.get(d.client_id) || 0) + bal)
    }
  }
  const out = new Map()
  for (const id of new Set([...owes.keys(), ...credit.keys()])) {
    const o = owes.get(id) || 0
    const c = credit.get(id) || 0
    out.set(id, { owes: o / 100, credit: c / 100, net: (o - c) / 100 })
  }
  return out
}

const SETTLED = Object.freeze({ owes: 0, credit: 0, net: 0 })
/** One client's position ({ owes, credit, net }), settled when nothing is open. */
export const positionOf = (positions, id) => positions?.get(id) || SETTLED

/** How a position reads: { status: 'owes' | 'credit' | 'clear', label, amount } (amount is never negative). */
export function describePosition(p) {
  const net = Number(p?.net) || 0
  if (net > 0) return { status: 'owes', label: 'Client owes us', amount: net }
  if (net < 0) return { status: 'credit', label: 'We owe client', amount: -net }
  return { status: 'clear', label: 'Settled', amount: 0 }
}

export function filterClients(clients, filters, positions = new Map()) {
  const f = { ...DEFAULT_CLIENT_FILTERS, ...filters }
  const bounds = periodBounds(f.period)
  return (clients || []).filter((c) => {
    const status = describePosition(positionOf(positions, c.id)).status
    const visits = Number(c.visit_count) || 0
    return matchesText([c.full_name, c.phone, c.email, c.address], f.search) &&
      inPeriod(c.created_at, bounds) &&
      (!f.gender || (f.gender === '__none' ? !c.gender : normText(c.gender) === normText(f.gender))) &&
      (!f.paymentStatus || f.paymentStatus === status) &&
      (!f.activity || (f.activity === 'active' ? visits > 0 : visits === 0)) &&
      inAmountRange(c.total_spend, f.spend) &&
      inAmountRange(visits, f.visits)
  })
}

// Totals for the clients shown: how many, their lifetime spend and visits, what clients owe the business (owed, by
// `owing` clients) and what it owes clients (credit, to `inCredit` clients), each from the client's net position.
export function clientTotals(clients, positions = new Map()) {
  let spend = 0
  let owed = 0
  let credit = 0
  let visits = 0
  let owing = 0
  let inCredit = 0
  for (const c of clients || []) {
    spend += toKobo(c.total_spend)
    visits += Number(c.visit_count) || 0
    const net = toKobo(positionOf(positions, c.id).net)
    if (net > 0) { owed += net; owing++ }
    if (net < 0) { credit -= net; inCredit++ }
  }
  const count = (clients || []).length
  return { count, spend: spend / 100, owed: owed / 100, owing, credit: credit / 100, inCredit, visits, averageSpend: count ? Math.round(spend / count) / 100 : 0 }
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
