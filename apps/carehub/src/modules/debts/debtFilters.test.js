import { describe, it, expect } from 'vitest'
import { DEFAULT_DEBT_FILTERS, filterDebts, debtPaymentStatus, activeDebtFilterCount, describeDebtFilters } from './debtFilters'
import { debtTotals } from './debtTotals'

const fmt = (n) => '₦' + Number(n).toLocaleString('en-NG')
const D = [
  { id: 'a', business_id: 'L1', party_name: 'Bola Ade', direction: 'owes_us', amount: 5000, amount_paid: 2000, balance: 3000, status: 'pending', source: 'credit_sale', created_at: '2026-10-21T09:00:00' },
  { id: 'b', business_id: 'L1', party_name: 'Chidi', direction: 'owes_us', amount: 700, amount_paid: 0, balance: 700, status: 'pending', source: 'manual', created_at: '2026-09-02T10:00:00' },
  { id: 'c', business_id: 'L2', party_name: 'Emzor Ltd', direction: 'we_owe', amount: 9000, amount_paid: 0, balance: 9000, status: 'pending', source: 'purchase', created_at: '2025-12-31T23:00:00' },
  { id: 'd', business_id: 'L2', party_name: 'Bola Ade', direction: 'owes_us', amount: 800, amount_paid: 800, balance: 0, status: 'paid', source: 'credit_sale', created_at: '2026-10-05T08:00:00' },
  { id: 'e', business_id: 'L1', party_name: 'Old record', direction: 'owes_us', amount: 100, amount_paid: 0, balance: 100, status: 'pending', source: null, created_at: '2026-01-15T08:00:00' },
]
const ids = (rows) => rows.map((r) => r.id)
const f = (patch) => ({ ...DEFAULT_DEBT_FILTERS, ...patch })

describe('debtPaymentStatus', () => {
  it('reads paid, partially paid and unpaid from the amounts', () => {
    expect(D.map(debtPaymentStatus)).toEqual(['partial', 'unpaid', 'unpaid', 'paid', 'unpaid'])
    expect(debtPaymentStatus({ status: 'pending', balance: 0, amount_paid: 50 })).toBe('paid')
    expect(debtPaymentStatus({ status: 'paid', balance: 20 })).toBe('paid')
  })
})

describe('filterDebts', () => {
  it('no filters keeps everything', () => {
    expect(ids(filterDebts(D, DEFAULT_DEBT_FILTERS))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('by year, month, day and custom range (calendar day of the record)', () => {
    expect(ids(filterDebts(D, f({ period: { mode: 'year', year: '2025' } })))).toEqual(['c'])
    expect(ids(filterDebts(D, f({ period: { mode: 'month', month: '2026-10' } })))).toEqual(['a', 'd'])
    expect(ids(filterDebts(D, f({ period: { mode: 'day', date: '2026-09-02' } })))).toEqual(['b'])
    expect(ids(filterDebts(D, f({ period: { mode: 'range', from: '2026-01-01', to: '2026-09-30' } })))).toEqual(['b', 'e'])
  })

  it('by party name, location, payment status, source and direction', () => {
    expect(ids(filterDebts(D, f({ search: '  BOLA ' })))).toEqual(['a', 'd'])
    expect(ids(filterDebts(D, f({ location: 'L2' })))).toEqual(['c', 'd'])
    expect(ids(filterDebts(D, f({ location: 'all' })))).toHaveLength(5)
    expect(ids(filterDebts(D, f({ status: 'partial' })))).toEqual(['a'])
    expect(ids(filterDebts(D, f({ status: 'unpaid' })))).toEqual(['b', 'c', 'e'])
    expect(ids(filterDebts(D, f({ source: 'purchase' })))).toEqual(['c'])
    expect(ids(filterDebts(D, f({ source: 'manual' })))).toEqual(['b', 'e'])
    expect(ids(filterDebts(D, f({ direction: 'we_owe' })))).toEqual(['c'])
  })

  it('by outstanding balance or original amount range (inclusive, either end open, reversed ends fixed)', () => {
    expect(ids(filterDebts(D, f({ amount: { min: '700', max: '3000' } })))).toEqual(['a', 'b'])
    expect(ids(filterDebts(D, f({ amount: { min: '3000', max: '700' } })))).toEqual(['a', 'b'])
    expect(ids(filterDebts(D, f({ amount: { min: '', max: '0' } })))).toEqual(['d'])
    expect(ids(filterDebts(D, f({ amountBasis: 'amount', amount: { min: '5000', max: '' } })))).toEqual(['a', 'c'])
    expect(ids(filterDebts(D, f({ amount: { min: 'abc', max: '' } })))).toHaveLength(5)
  })

  it('combined filters, and the totals follow them', () => {
    const rows = filterDebts(D, f({ search: 'bola', status: 'partial', location: 'L1' }))
    expect(ids(rows)).toEqual(['a'])
    expect(debtTotals(filterDebts(D, f({ location: 'L2' })))).toMatchObject({ owedToUs: 0, weOwe: 9000, outstanding: 9000 })
  })
})

describe('activeDebtFilterCount and describeDebtFilters', () => {
  it('counts what is set; the location in use is not a filter', () => {
    expect(activeDebtFilterCount(DEFAULT_DEBT_FILTERS)).toBe(0)
    expect(activeDebtFilterCount(f({ location: 'L1' }), 'L1')).toBe(0)
    expect(activeDebtFilterCount(f({ location: 'all', status: 'paid', search: 'x', amount: { min: '1', max: '' } }), 'L1')).toBe(4)
  })

  it('describes the filters in words', () => {
    const text = describeDebtFilters(f({ search: 'bola', period: { mode: 'month', month: '2026-10' }, location: 'L2', status: 'unpaid', amount: { min: '1000', max: '' } }),
      { fmt, locationName: (id) => (id === 'L2' ? 'Ikeja branch' : ''), defaultLocation: 'L1' })
    expect(text).toBe('"bola" · Oct 2026 · Ikeja branch · Unpaid · outstanding at least ₦1,000')
    expect(describeDebtFilters(f({ location: 'all' }), { defaultLocation: 'L1' })).toBe('all locations')
  })
})
