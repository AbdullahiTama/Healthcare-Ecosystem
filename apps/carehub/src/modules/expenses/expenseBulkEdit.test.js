import { describe, it, expect } from 'vitest'
import { EMPTY_EXPENSE_BULK_EDIT, validateExpenseBulkEdit, planExpenseBulkEdit } from './expenseBulkEdit'

const CATS = ['Rent', 'Transport', 'Utilities']
const X = [
  { id: 'a', category: 'Transport', description: 'Fuel', amount: 800, date: '2026-11-03', staff_name: 'Ada' },
  { id: 'b', category: 'Other', description: '', amount: 300, date: '2026-11-04', staff_name: '' },
]
const c = (patch) => ({ ...EMPTY_EXPENSE_BULK_EDIT, ...patch })
const opts = { categories: CATS, today: '2026-11-10' }

describe('expense bulk edit', () => {
  it('nothing filled in changes nothing; bad values are refused', () => {
    expect(validateExpenseBulkEdit(EMPTY_EXPENSE_BULK_EDIT, opts)).toEqual({ errors: {}, ok: true, hasChanges: false })
    expect(validateExpenseBulkEdit(c({ category: 'Party' }), opts).errors.category).toMatch(/from the list/)
    expect(validateExpenseBulkEdit(c({ date: '2026-02-30' }), opts).errors.date).toMatch(/valid date/)
    expect(validateExpenseBulkEdit(c({ date: '2026-12-01' }), opts).errors.date).toMatch(/future/)
    expect(planExpenseBulkEdit(X, c({ category: 'Party' }), opts)).toEqual([])
  })
  it('recategorises, re-dates and sets the staff name only where they differ', () => {
    expect(planExpenseBulkEdit(X, c({ category: 'Transport', date: '2026-11-03', staffName: ' Ada ' }), opts)).toEqual([
      { id: 'b', label: 'Other', updates: { category: 'Transport', date: '2026-11-03', staff_name: 'Ada' }, before: { category: 'Other', date: '2026-11-04', staff_name: null } },
    ])
  })
})
