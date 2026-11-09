import { describe, it, expect } from 'vitest'
import { defaultExpenseFilters, filterExpenses, sortExpenses, expenseTotals, expenseRecorders, activeExpenseFilterCount, describeExpenseFilters } from './expenseFilters'

const fmt = (n) => '₦' + Number(n).toLocaleString('en-NG')
const E = [
  { id: '1', category: 'Rent', description: 'Shop rent', amount: 50000, date: '2026-10-01', staff_name: 'Ada', created_at: '2026-10-01T09:00:00' },
  { id: '2', category: 'Transport', description: 'Fuel', amount: 0.1, date: '2026-10-15', staff_name: '', recorded_by_name: 'Musa', created_at: '2026-10-15T09:00:00' },
  { id: '3', category: 'Transport', description: 'Bike', amount: 0.2, date: 'not a date', staff_name: 'ada ', created_at: '2026-09-30T23:00:00' },
  { id: '4', category: 'Utilities', description: 'NEPA', amount: 12000, date: '2025-03-02', staff_name: 'Bisi', created_at: '2025-03-02T09:00:00' },
]
const ids = (r) => r.map((x) => x.id)
const f = (patch) => ({ ...defaultExpenseFilters('2026-10'), ...patch })

describe('filterExpenses', () => {
  it('opens on the month given, using the expense date (or the day recorded when the date is unusable)', () => {
    expect(ids(filterExpenses(E, defaultExpenseFilters('2026-10')))).toEqual(['1', '2'])
    expect(ids(filterExpenses(E, f({ period: { mode: 'month', month: '2026-09' } })))).toEqual(['3'])
    expect(ids(filterExpenses(E, f({ period: { mode: 'year', year: '2025' } })))).toEqual(['4'])
    expect(ids(filterExpenses(E, f({ period: { mode: 'day', date: '2026-10-15' } })))).toEqual(['2'])
    expect(ids(filterExpenses(E, f({ period: { mode: 'all' } })))).toHaveLength(4)
  })

  it('by category, recorder (stamped name first, any capitalisation), search and amount', () => {
    const all = { period: { mode: 'all' } }
    expect(ids(filterExpenses(E, f({ ...all, category: 'Transport' })))).toEqual(['2', '3'])
    expect(ids(filterExpenses(E, f({ ...all, recordedBy: 'ADA' })))).toEqual(['1', '3'])
    expect(ids(filterExpenses(E, f({ ...all, recordedBy: 'Musa' })))).toEqual(['2'])
    expect(ids(filterExpenses(E, f({ ...all, search: 'fuel' })))).toEqual(['2'])
    expect(ids(filterExpenses(E, f({ ...all, amount: { min: '10000', max: '' } })))).toEqual(['1', '4'])
  })
})

describe('totals, sort, recorders, count and words', () => {
  it('totals in whole kobo with the category breakdown largest first', () => {
    expect(expenseTotals(E.slice(1, 3))).toEqual({ total: 0.3, paid: 0.3, outstanding: 0, open: 0, count: 2, byCategory: [{ category: 'Transport', total: 0.3 }] })
    expect(expenseTotals(E).byCategory.map((c) => c.category)).toEqual(['Rent', 'Utilities', 'Transport'])
  })
  it('sorts newest first and lists recorders once', () => {
    expect(ids(sortExpenses(E))).toEqual(['2', '1', '3', '4'])
    expect(expenseRecorders(E)).toEqual(['Ada', 'Bisi', 'Musa'])
  })
  it('the default month is not a filter; others are counted and described', () => {
    expect(activeExpenseFilterCount(defaultExpenseFilters('2026-10'), '2026-10')).toBe(0)
    const filters = f({ category: 'Rent', amount: { min: '', max: '60000' } })
    expect(activeExpenseFilterCount(filters, '2026-10')).toBe(2)
    expect(describeExpenseFilters(filters, { fmt })).toBe('Oct 2026 · Rent · amount up to ₦60,000')
  })
})

describe('payment status', () => {
  const P = [
    { id: 'p', category: 'Rent', amount: 1000, amount_paid: 1000, date: '2026-10-01' },
    { id: 'h', category: 'Rent', amount: 1000, amount_paid: 250.5, date: '2026-10-02' },
    { id: 'u', category: 'Rent', amount: 500, amount_paid: 0, date: '2026-10-03' },
    { id: 'l', category: 'Rent', amount: 200, date: '2026-10-04' }, // before payment status: paid
  ]
  const all = { period: { mode: 'all' } }
  it('filters paid, partially paid and unpaid', () => {
    expect(ids(filterExpenses(P, f({ ...all, paymentStatus: 'paid' })))).toEqual(['p', 'l'])
    expect(ids(filterExpenses(P, f({ ...all, paymentStatus: 'partial' })))).toEqual(['h'])
    expect(ids(filterExpenses(P, f({ ...all, paymentStatus: 'unpaid' })))).toEqual(['u'])
  })
  it('totals what was spent, paid and is still owed', () => {
    expect(expenseTotals(P)).toMatchObject({ total: 2700, paid: 1450.5, outstanding: 1249.5, open: 2 })
  })
  it('counts and describes the status filter', () => {
    const filters = f({ paymentStatus: 'unpaid' })
    expect(activeExpenseFilterCount(filters, '2026-10')).toBe(1)
    expect(describeExpenseFilters(filters, { fmt })).toBe('Oct 2026 · Unpaid')
  })
})

describe('"Not fully paid" filter', () => {
  it('keeps unpaid and partially paid expenses together', () => {
    const P = [{ id: 'p', amount: 10, amount_paid: 10 }, { id: 'h', amount: 10, amount_paid: 4 }, { id: 'u', amount: 10, amount_paid: 0 }]
    expect(ids(filterExpenses(P, f({ period: { mode: 'all' }, paymentStatus: 'open' })))).toEqual(['h', 'u'])
    expect(describeExpenseFilters(f({ period: { mode: 'all' }, paymentStatus: 'open' }), { fmt })).toBe('All time · Not fully paid')
  })
})
