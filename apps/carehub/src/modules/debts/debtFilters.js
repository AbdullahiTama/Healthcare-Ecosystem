// The Debts page filter: which debts a combination of filters leaves, and how to describe it. Pure, so the page and
// its tests share one definition. Totals for the rows it leaves come from debtTotals.js.
import { ALL_TIME, periodBounds } from '../../lib/datePeriods'
import { matchesText, inAmountRange, inPeriod, isAmountRangeSet, amountRangeLabel } from '../../lib/recordFilters'

export const PAYMENT_STATUSES = [['unpaid', 'Unpaid'], ['partial', 'Partially paid'], ['paid', 'Paid']]
// The `source` column is how the debt arose: the transaction type.
export const DEBT_SOURCES = [['credit_sale', 'Credit sale'], ['purchase', 'Purchase'], ['manual', 'Recorded by hand']]
export const DIRECTIONS = [['owes_us', 'Owed to us'], ['we_owe', 'We owe others']]
export const AMOUNT_BASES = [['balance', 'Outstanding balance'], ['amount', 'Original amount']]

// `location`: '' or 'all' is every location loaded (one location for staff and single-site owners), or a business id.
export const DEFAULT_DEBT_FILTERS = Object.freeze({
  search: '', period: ALL_TIME, location: '', status: '', source: '', direction: '',
  amountBasis: 'balance', amount: Object.freeze({ min: '', max: '' }),
})

// Paid: nothing left (or closed as paid). Partially paid: something paid, something left. Unpaid: nothing paid yet.
// Derived from the amounts rather than the stored status, which only distinguishes "paid" from "pending".
export function debtPaymentStatus(d) {
  const balance = Number(d?.balance) || 0
  if (d?.status === 'paid' || balance <= 0) return 'paid'
  return (Number(d?.amount_paid) || 0) > 0 ? 'partial' : 'unpaid'
}

// A debt with no source predates the column; it was recorded by hand.
export const debtSource = (d) => d?.source || 'manual'

export function filterDebts(debts, filters) {
  const f = { ...DEFAULT_DEBT_FILTERS, ...filters }
  const bounds = periodBounds(f.period)
  return (debts || []).filter((d) =>
    matchesText([d.party_name], f.search) &&
    inPeriod(d.created_at, bounds) &&
    (!f.location || f.location === 'all' || String(d.business_id) === String(f.location)) &&
    (!f.status || debtPaymentStatus(d) === f.status) &&
    (!f.source || debtSource(d) === f.source) &&
    (!f.direction || d.direction === f.direction) &&
    inAmountRange(f.amountBasis === 'amount' ? d.amount : Math.max(Number(d.balance) || 0, 0), f.amount))
}

// How many filters are set. Location is not counted when it is the location in use (the page's default view).
export function activeDebtFilterCount(filters, defaultLocation = '') {
  const f = { ...DEFAULT_DEBT_FILTERS, ...filters }
  return [
    !!f.search.trim(),
    periodBounds(f.period).from !== null || periodBounds(f.period).to !== null,
    f.location !== defaultLocation,
    !!f.status, !!f.source, !!f.direction,
    isAmountRangeSet(f.amount),
  ].filter(Boolean).length
}

const labelOf = (pairs, v) => (pairs.find(([k]) => k === v) || [])[1]

// "“bola” · October 2026 · Unpaid · outstanding at least ₦1,000"; `locationName(id)` names a location.
export function describeDebtFilters(filters, { fmt, locationName, defaultLocation = '' } = {}) {
  const f = { ...DEFAULT_DEBT_FILTERS, ...filters }
  const b = periodBounds(f.period)
  const amount = fmt ? amountRangeLabel(f.amount, fmt) : ''
  return [
    f.search.trim() && `"${f.search.trim()}"`,
    (b.from || b.to) && b.label,
    f.location !== defaultLocation && (f.location && f.location !== 'all' ? (locationName?.(f.location) || 'one location') : 'all locations'),
    labelOf(PAYMENT_STATUSES, f.status),
    labelOf(DEBT_SOURCES, f.source),
    labelOf(DIRECTIONS, f.direction),
    amount && `${f.amountBasis === 'amount' ? 'original amount' : 'outstanding'} ${amount}`,
  ].filter(Boolean).join(' · ')
}
