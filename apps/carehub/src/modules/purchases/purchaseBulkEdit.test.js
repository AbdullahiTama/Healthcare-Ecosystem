import { describe, it, expect } from 'vitest'
import { EMPTY_PURCHASE_BULK_EDIT, validatePurchaseBulkEdit, planPurchaseBulkEdit, purchaseKeptText, runPurchaseBulkEdit } from './purchaseBulkEdit'

const P = [
  { id: 'a', supplier_name: 'MedSupply Ltd', supply_date: '2026-10-30', due_date: '', notes: '' },
  { id: 'b', supplier_name: 'MedSupply Nigeria Ltd', supply_date: '2026-10-29', due_date: '2026-12-31', notes: 'Q4' },
]
const c = (patch) => ({ ...EMPTY_PURCHASE_BULK_EDIT, reason: 'Supplier renamed', ...patch })
const opts = { today: '2026-11-10' }

describe('purchase bulk edit', () => {
  it('nothing filled in changes nothing and needs no reason', () => {
    expect(validatePurchaseBulkEdit(EMPTY_PURCHASE_BULK_EDIT, opts)).toEqual({ errors: {}, ok: true, hasChanges: false })
  })

  it('refuses bad values and a missing reason', () => {
    expect(validatePurchaseBulkEdit(c({ supplyDate: '2026-02-30' }), opts).errors.supplyDate).toMatch(/valid/)
    expect(validatePurchaseBulkEdit(c({ supplyDate: '2026-11-11' }), opts).errors.supplyDate).toMatch(/future/)
    expect(validatePurchaseBulkEdit(c({ dueMode: 'set' }), opts).errors.dueDate).toMatch(/valid due date/)
    expect(validatePurchaseBulkEdit(c({ notes: 'x'.repeat(1001) }), opts).errors.notes).toMatch(/1,000/)
    expect(validatePurchaseBulkEdit(c({ supplier: 'X', reason: 'no' }), opts).errors.reason).toMatch(/Say why/)
    expect(planPurchaseBulkEdit(P, c({ supplier: 'X', reason: '' }), opts)).toEqual([])
  })

  it('renames the supplier and sets a due date only where they differ', () => {
    expect(planPurchaseBulkEdit(P, c({ supplier: ' MedSupply Nigeria Ltd ', dueMode: 'set', dueDate: '2026-12-31' }), opts)).toEqual([
      { id: 'a', label: 'MedSupply Ltd · 2026-10-30', updates: { supplier_name: 'MedSupply Nigeria Ltd', due_date: '2026-12-31' }, before: { supplier_name: 'MedSupply Ltd', due_date: '' } },
    ])
  })

  it('removes due dates, sets the supply date and notes; only header fields', () => {
    const plan = planPurchaseBulkEdit(P, c({ dueMode: 'clear', supplyDate: '2026-10-30', notes: 'Q4' }), opts)
    expect(plan).toEqual([
      { id: 'a', label: 'MedSupply Ltd · 2026-10-30', updates: { notes: 'Q4' }, before: { notes: '' } },
      { id: 'b', label: 'MedSupply Nigeria Ltd · 2026-10-29', updates: { supply_date: '2026-10-30', due_date: '' }, before: { supply_date: '2026-10-29', due_date: '2026-12-31' } },
    ])
    for (const p of plan) expect(Object.keys(p.updates).every((k) => ['supplier_name', 'supply_date', 'due_date', 'notes'].includes(k))).toBe(true)
  })

  it('words why a purchase was kept', () => {
    expect(purchaseKeptText(['stock_used'], { product: 'ORS sachet' })).toMatch(/^some units \(ORS sachet\) were sold or moved since/)
    expect(purchaseKeptText(['not_linked'], {})).toMatch(/not linked to a product/)
  })
})

describe('runPurchaseBulkEdit', () => {
  it('collects saved rows, per-purchase failures (retryable), skips and unchanged as notes', async () => {
    const calls = []
    const bulkEdit = async (ids, updates) => {
      calls.push([ids, updates])
      return { updated: 1, unchanged: 1, rows: [{ id: 'a', supplier_name: 'New' }],
        failed: [{ id: 'c', name: 'Old', message: 'Enter a supply date that is not in the future.' }],
        skipped: [{ id: 'd', name: 'Late Ltd', reason: 'stock_differs' }] }
    }
    const progress = []
    const r = await runPurchaseBulkEdit([{ ids: ['a', 'b', 'c', 'd'], updates: { supplier_name: 'New' } }], bulkEdit,
      { onProgress: (d, t) => progress.push([d, t]), labels: { c: 'Old · 2026-10-01' } })
    expect(calls).toEqual([[['a', 'b', 'c', 'd'], { supplier_name: 'New' }]])
    expect(r.saved).toEqual([{ id: 'a', supplier_name: 'New' }])
    expect(r.failed).toEqual([{ ids: ['c'], updates: { supplier_name: 'New' }, message: 'Old · 2026-10-01: Enter a supply date that is not in the future.' }])
    expect(r.notes).toEqual(['1 skipped, because changing them would also change stock: Late Ltd (its stock in Inventory differs from its quantities). Edit it one at a time.', '1 already had these values.'])
    expect(progress).toEqual([[4, 4]])
  })

  it('a refused request fails its whole chunk; chunks of 25', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => 'p' + i)
    let n = 0
    const r = await runPurchaseBulkEdit([{ ids, updates: { notes: 'x' } }], async () => { if (n++ === 0) throw new Error('Only the owner can do this.'); return { rows: [], failed: [], skipped: [] } })
    expect(r.failed).toEqual([{ ids: ids.slice(0, 25), updates: { notes: 'x' }, message: 'Only the owner can do this.' }])
    expect(n).toBe(2)
  })
})
