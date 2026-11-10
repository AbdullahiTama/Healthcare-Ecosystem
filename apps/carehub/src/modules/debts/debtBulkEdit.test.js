import { describe, it, expect } from 'vitest'
import { EMPTY_DEBT_BULK_EDIT, validateDebtBulkEdit, planDebtBulkEdit, descriptionLockedCount } from './debtBulkEdit'

const D = [
  { id: 'a', party_name: 'Ada', source: 'manual', description: 'Borrowed cash', due_date: '2026-12-01', amount: 5000 },
  { id: 'b', party_name: 'Ben', source: 'credit_sale', source_ref: 'TXN-1', description: 'Credit sale', due_date: '' },
  { id: 'c', party_name: '', source: null, description: '', due_date: null },
]
const c = (patch) => ({ ...EMPTY_DEBT_BULK_EDIT, ...patch })

describe('debt bulk edit', () => {
  it('nothing filled in changes nothing; bad values are refused', () => {
    expect(validateDebtBulkEdit(EMPTY_DEBT_BULK_EDIT)).toEqual({ errors: {}, ok: true, hasChanges: false })
    expect(validateDebtBulkEdit(c({ dueMode: 'set', dueDate: '' })).errors.dueDate).toMatch(/valid due date/)
    expect(validateDebtBulkEdit(c({ dueMode: 'set', dueDate: '2026-02-30' })).errors.dueDate).toMatch(/valid due date/)
    expect(validateDebtBulkEdit(c({ description: 'x'.repeat(501) })).errors.description).toMatch(/500/)
    expect(planDebtBulkEdit(D, c({ dueMode: 'set', dueDate: 'soon' }))).toEqual([])
  })

  it('sets a due date on every debt that differs, sale debts included', () => {
    expect(planDebtBulkEdit(D, c({ dueMode: 'set', dueDate: '2026-12-01' }))).toEqual([
      { id: 'b', label: 'Ben', updates: { due_date: '2026-12-01' }, before: { due_date: '' } },
      { id: 'c', label: 'Unnamed', updates: { due_date: '2026-12-01' }, before: { due_date: '' } },
    ])
  })

  it('removes due dates only where one is set', () => {
    expect(planDebtBulkEdit(D, c({ dueMode: 'clear' }))).toEqual([{ id: 'a', label: 'Ada', updates: { due_date: '' }, before: { due_date: '2026-12-01' } }])
  })

  it('changes the description only on debts recorded by hand, never money fields', () => {
    const plan = planDebtBulkEdit(D, c({ description: ' Old balance ' }))
    expect(plan.map((p) => p.id)).toEqual(['a', 'c'])
    expect(plan[0].updates).toEqual({ description: 'Old balance' })
    for (const p of planDebtBulkEdit(D, c({ dueMode: 'clear', description: 'x' }))) {
      expect(Object.keys(p.updates).every((k) => k === 'due_date' || k === 'description')).toBe(true)
    }
    expect(descriptionLockedCount(D)).toBe(1)
  })
})
