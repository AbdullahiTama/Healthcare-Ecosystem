import { describe, it, expect } from 'vitest'
import { validateExpense, parseAmount, expenseDate, inMonth, sumExpenses, sumByCategory, expensePaymentStatus, expensePaid, expenseBalance } from './expenseRules.js'
import { EXPENSE_CATS } from '../../config/constants.js'

const good = { category: 'Rent', amount: '1,250.50', date: '2026-10-05', description: ' Shop rent ', staffName: ' Ada ' }

describe('validateExpense', () => {
  it('accepts a valid expense and returns the payload to persist', () => {
    const r = validateExpense(good, EXPENSE_CATS)
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ category: 'Rent', description: 'Shop rent', amount: 1250.5, date: '2026-10-05', staff_name: 'Ada', amount_paid: 1250.5, payment_method: 'Cash' })
  })

  it('payment: part paid keeps the deposit and its method; not paid yet stores nothing paid', () => {
    expect(validateExpense({ ...good, payment: 'partial', amountPaid: '250', paymentMethod: 'Transfer' }, EXPENSE_CATS).value)
      .toMatchObject({ amount: 1250.5, amount_paid: 250, payment_method: 'Transfer' })
    expect(validateExpense({ ...good, payment: 'unpaid', paymentMethod: 'Transfer' }, EXPENSE_CATS).value)
      .toMatchObject({ amount_paid: 0, payment_method: null })
  })

  it.each([
    [{ payment: 'partial' }, 'amountPaid', /how much was paid/],
    [{ payment: 'partial', amountPaid: '0' }, 'amountPaid', /more than zero/],
    [{ payment: 'partial', amountPaid: '1250.5' }, 'amountPaid', /Paid in full/],
    [{ payment: 'partial', amountPaid: '9.999' }, 'amountPaid', /valid amount/],
    [{ payment: 'later' }, 'payment', /whether/],
    [{ paymentMethod: 'Bitcoin' }, 'paymentMethod', /how it was paid/],
  ])('payment errors %j', (patch, field, message) => {
    const r = validateExpense({ ...good, ...patch }, EXPENSE_CATS)
    expect(r.ok).toBe(false)
    expect(r.errors[field]).toMatch(message)
  })

  it('status, paid and balance; an expense from before payment status is paid in full', () => {
    expect([{ amount: 100 }, { amount: 100, amount_paid: 40 }, { amount: 100, amount_paid: 0 }, { amount: 100, amount_paid: '100' }].map(expensePaymentStatus))
      .toEqual(['paid', 'partial', 'unpaid', 'paid'])
    expect(expensePaid({ amount: 100 })).toBe(100)
    expect(expenseBalance({ amount: 100.3, amount_paid: 0.1 })).toBe(100.2)
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
    expect(budgetSummary(50000, 0)).toEqual({ active: true, remaining: 50000, pctUsed: 0, over: false, near: false, exhausted: false })
    expect(budgetSummary(50000, 12000.1)).toMatchObject({ remaining: 37999.9, pctUsed: 24 })
    expect(budgetSummary(50000, 40000)).toMatchObject({ remaining: 10000, near: true, over: false })
    expect(budgetSummary(50000, 50000.01)).toMatchObject({ remaining: -0.01, over: true, near: false })
    expect(budgetSummary(0.3, 0.1 + 0.2)).toMatchObject({ remaining: 0, over: false, exhausted: true })
    expect(budgetSummary(0, 100)).toEqual({ active: false, remaining: 0, pctUsed: 0, over: false, near: false, exhausted: false })
  })
})

describe('set new budget rules', async () => {
  const { budgetStartDay, spentSince, newBudgetStartRange, validateNewBudget, lastDayOfMonth } = await import('./expenseRules')
  const list = [
    { amount: 40000, date: '2026-11-02' }, { amount: 12000, date: '2026-11-17' }, { amount: 4000, date: '2026-11-18' },
    { amount: 999, date: '2026-10-31' }, { amount: 7, date: 'bad', created_at: '2026-11-20T08:00:00' },
  ]
  it('a budget begun mid-month counts from its start; a carried-over or whole-month one from the 1st', () => {
    expect(budgetStartDay({ month: '2026-11', startsOn: '2026-11-18' }, '2026-11')).toBe('2026-11-18')
    expect(budgetStartDay({ month: '2026-11', startsOn: null }, '2026-11')).toBe('2026-11-01')
    expect(budgetStartDay({ month: '2026-10', startsOn: '2026-10-20' }, '2026-11')).toBe('2026-11-01')
    expect(spentSince(list, '2026-11', '2026-11-01')).toBe(56007)
    expect(spentSince(list, '2026-11', '2026-11-18')).toBe(4007) // includes the expense dated by when it was recorded
  })

  it('a new budget may start after the current start, to the month end; today by default', () => {
    expect(newBudgetStartRange('2026-11', '2026-11-01', '2026-11-18')).toEqual({ min: '2026-11-02', max: '2026-11-30', defaultDay: '2026-11-18' })
    expect(newBudgetStartRange('2026-11', '2026-11-18', '2026-12-03')).toEqual({ min: '2026-11-19', max: '2026-11-30', defaultDay: '2026-11-19' })
    expect(newBudgetStartRange('2026-02', '2026-02-28', '2026-02-28')).toBeNull()
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
  })

  it('validates the amount and the start', () => {
    const range = { min: '2026-11-02', max: '2026-11-30' }
    expect(validateNewBudget({ amount: '30,000', startsOn: '2026-11-18' }, range)).toEqual({ ok: true, errors: {}, value: { amount: 30000, startsOn: '2026-11-18' } })
    expect(validateNewBudget({ amount: '0', startsOn: '2026-11-18' }, range).errors).toEqual({ amount: 'The new budget must be more than zero.' })
    expect(validateNewBudget({ amount: '5', startsOn: '2026-11-01' }, range).errors).toEqual({ startsOn: 'Choose a day from 2026-11-02 to 2026-11-30.' })
    expect(validateNewBudget({ amount: '5', startsOn: '2026-11-05' }, null).errors.startsOn).toMatch(/cannot start/)
  })
})
