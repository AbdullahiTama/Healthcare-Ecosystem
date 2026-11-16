import { describe, it, expect } from 'vitest'
import { DEFAULT_CLIENT_FILTERS, clientPositions, positionOf, describePosition, filterClients, clientTotals, activeClientFilterCount, describeClientFilters } from './clientFilters'

const fmt = (n) => '₦' + Number(n).toLocaleString('en-NG')
const C = [
  { id: 'c1', full_name: 'Ada Obi', phone: '0801', email: 'ada@x.com', gender: 'Female', total_spend: 12000, visit_count: 4, created_at: '2026-10-03T10:00:00' },
  { id: 'c2', full_name: 'Musa Bello', phone: '0802', gender: 'Male', total_spend: 0, visit_count: 0, created_at: '2026-09-15T10:00:00' },
  { id: 'c3', full_name: 'Chi Eze', phone: '0803', gender: '', total_spend: 3000.5, visit_count: 1, created_at: '2025-06-01T10:00:00' },
  { id: 'c4', full_name: 'Chi Eze', phone: '0804', gender: 'Female', total_spend: 500, visit_count: 1, created_at: '2026-10-20T10:00:00' },
]
const DEBTS = [
  { client_id: 'c1', direction: 'owes_us', balance: 2000, status: 'pending' },
  { client_id: null, party_name: '  musa  BELLO', direction: 'owes_us', balance: 700, status: 'pending' },
  { client_id: null, party_name: 'Chi Eze', direction: 'owes_us', balance: 999, status: 'pending' }, // two clients share the name: nobody's
  { client_id: 'c1', direction: 'we_owe', balance: 5000, status: 'pending' },                          // we owe Ada (opening balance)
  { client_id: null, party_name: 'Musa Bello', direction: 'we_owe', balance: 400, status: 'pending' }, // a supplier sharing Musa's name: not his
  { client_id: 'c1', direction: 'owes_us', balance: 0, status: 'paid' },
]
const ids = (rows) => rows.map((r) => r.id)
const f = (patch) => ({ ...DEFAULT_CLIENT_FILTERS, ...patch })

describe('clientPositions', () => {
  it('nets what each client owes against what the business owes them', () => {
    const p = clientPositions(C, DEBTS)
    expect(p.get('c1')).toEqual({ owes: 2000, credit: 5000, net: -3000 })
    expect(p.get('c2')).toEqual({ owes: 700, credit: 0, net: 700 })
    expect(p.has('c3')).toBe(false)
    expect(p.has('c4')).toBe(false)
    expect(positionOf(p, 'c3')).toEqual({ owes: 0, credit: 0, net: 0 })
  })

  it('reads as Client owes us, We owe client or Settled', () => {
    expect(describePosition({ net: 700 })).toEqual({ status: 'owes', label: 'Client owes us', amount: 700 })
    expect(describePosition({ net: -3000 })).toEqual({ status: 'credit', label: 'We owe client', amount: 3000 })
    expect(describePosition({ net: 0 })).toEqual({ status: 'clear', label: 'Settled', amount: 0 })
    expect(describePosition(undefined).status).toBe('clear')
  })
})

describe('filterClients', () => {
  const b = clientPositions(C, DEBTS)
  it('by date joined (year, month, range) and search across name, phone, email', () => {
    expect(ids(filterClients(C, f({ period: { mode: 'year', year: '2025' } }), b))).toEqual(['c3'])
    expect(ids(filterClients(C, f({ period: { mode: 'month', month: '2026-10' } }), b))).toEqual(['c1', 'c4'])
    expect(ids(filterClients(C, f({ search: 'ADA@' }), b))).toEqual(['c1'])
    expect(ids(filterClients(C, f({ search: '0803' }), b))).toEqual(['c3'])
  })

  it('by payment status, purchase activity and gender', () => {
    expect(ids(filterClients(C, f({ paymentStatus: 'owes' }), b))).toEqual(['c2'])
    expect(ids(filterClients(C, f({ paymentStatus: 'credit' }), b))).toEqual(['c1'])
    expect(ids(filterClients(C, f({ paymentStatus: 'clear' }), b))).toEqual(['c3', 'c4'])
    expect(ids(filterClients(C, f({ activity: 'never' }), b))).toEqual(['c2'])
    expect(ids(filterClients(C, f({ gender: 'female' }), b))).toEqual(['c1', 'c4'])
    expect(ids(filterClients(C, f({ gender: '__none' }), b))).toEqual(['c3'])
  })

  it('by spend and visit ranges', () => {
    expect(ids(filterClients(C, f({ spend: { min: '1000', max: '' } }), b))).toEqual(['c1', 'c3'])
    expect(ids(filterClients(C, f({ visits: { min: '1', max: '1' } }), b))).toEqual(['c3', 'c4'])
  })
})

describe('clientTotals', () => {
  it('totals the clients shown in whole kobo', () => {
    const b = clientPositions(C, DEBTS)
    expect(clientTotals(C, b)).toEqual({ count: 4, spend: 15500.5, owed: 700, owing: 1, credit: 3000, inCredit: 1, visits: 6, averageSpend: 3875.13 })
    expect(clientTotals([], b)).toEqual({ count: 0, spend: 0, owed: 0, owing: 0, credit: 0, inCredit: 0, visits: 0, averageSpend: 0 })
  })
})

describe('describe and count', () => {
  it('counts and words the filters', () => {
    const filters = f({ search: 'ada', period: { mode: 'year', year: '2026' }, paymentStatus: 'owes', spend: { min: '', max: '5000' } })
    expect(activeClientFilterCount(DEFAULT_CLIENT_FILTERS)).toBe(0)
    expect(activeClientFilterCount(filters)).toBe(4)
    expect(describeClientFilters(filters, { fmt })).toBe('"ada" · joined 2026 · Client owes us · spent up to ₦5,000')
  })
})
