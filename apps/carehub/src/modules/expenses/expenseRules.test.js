import { describe, it, expect } from 'vitest'
import { validateExpense, parseAmount, expenseDate, inMonth, sumExpenses, sumByCategory } from './expenseRules.js'
import { EXPENSE_CATS } from '../../config/constants.js'

const good = { category: 'Rent', amount: '1,250.50', date: '2026-10-05', description: ' Shop rent ', staffName: ' Ada ' }

describe('validateExpense', () => {
  it('accepts a valid expense and returns the payload to persist', () => {
    const r = validateExpense(good, EXPENSE_CATS)
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ category: 'Rent', description: 'Shop rent', amount: 1250.5, date: '2026-10-05', staff_name: 'Ada' })
  })

  it.each([['0'], ['-5'], ['abc'], ['1.234'], ['1e3'], ['']])('rejects the amount %j', (amount) => {
    const r = validateExpense({ ...good, amount }, EXPENSE_CATS)
    expect(r.ok).toBe(false)
    expect(r.errors.amount).toBeTruthy()
    expect(r.value).toBeNull()
  })

  it('reports every missing required field at once', () => {
    const r = validateExpense({}, EXPENSE_CATS)
    expect(Object.keys(r.errors).sort()).toEqual(['amount', 'category', 'date'])
  })

  it('rejects a category outside the list and an impossible date', () => {
    expect(validateExpense({ ...good, category: 'Gold plating' }, EXPENSE_CATS).errors.category).toBeTruthy()
    expect(validateExpense({ ...good, date: '2026-02-31' }, EXPENSE_CATS).errors.date).toBeTruthy()
  })
})

describe('parseAmount', () => {
  it('reads what people type', () => {
    expect(parseAmount('1,000')).toBe(1000)
    expect(parseAmount(' 300 ')).toBe(300)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount(250)).toBe(250)
  })
})

describe('which date an expense belongs to', () => {
  it('prefers the recorded date, falls back to creation for missing or impossible dates', () => {
    expect(expenseDate({ date: '2026-09-30', created_at: '2026-10-02T09:00:00' })).toBe('2026-09-30')
    expect(expenseDate({ date: null, created_at: '2026-10-20T23:30:00' })).toBe('2026-10-20')
    expect(expenseDate({ date: '2026-02-31', created_at: '2026-10-11T10:00:00' })).toBe('2026-10-11')
  })

  it('inMonth uses that date, so a back-dated expense is excluded from the current month', () => {
    const e = { date: '2026-09-30', created_at: '2026-10-02T09:00:00' }
    expect(inMonth(e, '2026-10')).toBe(false)
    expect(inMonth(e, '2026-09')).toBe(true)
    expect(inMonth(e, '')).toBe(true) // all time
  })
})

describe('totals', () => {
  it('adds decimals exactly', () => {
    expect(sumExpenses([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
    expect(sumExpenses([{ amount: '1000.10' }, { amount: 49.65 }, { amount: 10 }])).toBe(1059.75)
  })

  it('an empty list is zero and groups by category', () => {
    expect(sumExpenses([])).toBe(0)
    expect(sumExpenses(undefined)).toBe(0)
    expect(sumByCategory([{ category: 'Rent', amount: 1.1 }, { category: 'Rent', amount: 2.2 }, { category: 'Tax', amount: 5 }]))
      .toEqual({ Rent: 3.3, Tax: 5 })
  })
})

describe('monthly budget rules', async () => {
  const { effectiveBudget, legacyBudgetEntries, budgetSummary } = await import('./expenseRules')

  it('a month uses its own budget, else the latest earlier one', () => {
    const b = { '2026-09': 40000, '2026-10': 50000, '2027-01': 0 }
    expect(effectiveBudget(b, '2026-10')).toEqual({ month: '2026-10', amount: 50000 })
    expect(effectiveBudget(b, '2026-11')).toEqual({ month: '2026-10', amount: 50000 })
    expect(effectiveBudget(b, '2027-02')).toEqual({ month: '2027-01', amount: 0 })
    expect(effectiveBudget(b, '2026-08')).toBeNull()
    expect(effectiveBudget(b, '')).toBeNull()
    expect(effectiveBudget(undefined, '2026-11')).toBeNull()
    expect(effectiveBudget({ 'bad': 1, '2026-10': 'x' }, '2026-11')).toBeNull()
  })

  it('reads the old browser budgets for one business, valid ones only, oldest first', () => {
    const stored = { A: { '2026-10': 50000, '2026-09': '40000', '2026-13': 5, '2026-08': 0, '2026-07': -1, '2026-06': 'abc' }, B: { '2026-10': 1 } }
    expect(legacyBudgetEntries(stored, 'A')).toEqual([{ month: '2026-09', amount: 40000 }, { month: '2026-10', amount: 50000 }])
    expect(legacyBudgetEntries(stored, 'C')).toEqual([])
    expect(legacyBudgetEntries(null, 'A')).toEqual([])
  })

  it('every recorded expense reduces what remains, to the kobo', () => {
    expect(budgetSummary(50000, 0)).toEqual({ active: true, remaining: 50000, pctUsed: 0, over: false, near: false })
    expect(budgetSummary(50000, 12000.1)).toMatchObject({ remaining: 37999.9, pctUsed: 24 })
    expect(budgetSummary(50000, 40000)).toMatchObject({ remaining: 10000, near: true, over: false })
    expect(budgetSummary(50000, 50000.01)).toMatchObject({ remaining: -0.01, over: true, near: false })
    expect(budgetSummary(0.3, 0.1 + 0.2)).toMatchObject({ remaining: 0, over: false })
    expect(budgetSummary(0, 100)).toEqual({ active: false, remaining: 0, pctUsed: 0, over: false, near: false })
  })
})
