import { describe, it, expect, vi } from 'vitest'
import { EMPTY_BULK_EDIT, validateBulkEdit, planBulkEdit, groupBulkUpdates, runBulkUpdates, keptReasonText } from './bulkEdit'

const P = [
  { id: 'a', name: 'Amoxil', category: 'Medicines', price: 1000, cost_price: 600, reorder_level: 5, shelf_label: 'A1', list_on_carefind: true },
  { id: 'b', name: 'Vitamin C', category: 'Supplements', price: 333.33, cost_price: null, reorder_level: 10, shelf_label: null, list_on_carefind: false },
  { id: 'c', name: 'Consultation', category: 'Services', price: 2000, reorder_level: null },
]
const c = (patch) => ({ ...EMPTY_BULK_EDIT, ...patch })
const PRICES = { canEditPrice: true }

describe('validateBulkEdit', () => {
  it('nothing filled in is valid but changes nothing', () => {
    expect(validateBulkEdit(EMPTY_BULK_EDIT)).toEqual({ errors: {}, ok: true, hasChanges: false })
  })
  it.each([
    [{ price: { mode: 'set', value: '' } }, 'price', /new price/],
    [{ price: { mode: 'set', value: '-5' } }, 'price', /0 or more/],
    [{ price: { mode: 'increase', value: '0' } }, 'price', /more than 0%/],
    [{ cost_price: { mode: 'decrease', value: '100' } }, 'cost_price', /less than 100%/],
    [{ reorder_level: '2.5' }, 'reorder_level', /whole number/],
    [{ shelf_label: 'x'.repeat(51) }, 'shelf_label', /under 50/],
  ])('rejects %j', (patch, field, msg) => {
    const r = validateBulkEdit(c(patch), PRICES)
    expect(r.ok).toBe(false)
    expect(r.errors[field]).toMatch(msg)
  })
  it('prices need the price permission, as in the single-product form', () => {
    expect(validateBulkEdit(c({ price: { mode: 'set', value: '500' } }), { canEditPrice: false }).errors.price).toMatch(/allowed to edit prices/)
  })
})

describe('planBulkEdit', () => {
  it('sets category, shelf, reorder level and CareFind; leaves services\' reorder level alone; skips what already matches', () => {
    const plan = planBulkEdit(P, c({ category: ' Medicines ', shelf_label: 'B2', reorder_level: '10', list_on_carefind: 'yes' }))
    expect(plan).toEqual([
      { id: 'a', name: 'Amoxil', updates: { shelf_label: 'B2', reorder_level: 10 }, before: { shelf_label: 'A1', reorder_level: 5 } },
      { id: 'b', name: 'Vitamin C', updates: { category: 'Medicines', shelf_label: 'B2', list_on_carefind: true }, before: { category: 'Supplements', shelf_label: null, list_on_carefind: false } },
      { id: 'c', name: 'Consultation', updates: { category: 'Medicines', shelf_label: 'B2' }, before: { category: 'Services', shelf_label: null } },
    ])
  })
  it('raises or lowers prices by a percentage, rounded to kobo, or sets a fixed price', () => {
    expect(planBulkEdit(P.slice(0, 2), c({ price: { mode: 'increase', value: '10' } }), PRICES).map((x) => x.updates.price)).toEqual([1100, 366.66])
    expect(planBulkEdit(P.slice(0, 1), c({ price: { mode: 'decrease', value: '25' } }), PRICES)[0].updates).toEqual({ price: 750 })
    expect(planBulkEdit(P, c({ price: { mode: 'set', value: '2000' } }), PRICES).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('an invalid set of changes plans nothing', () => {
    expect(planBulkEdit(P, c({ price: { mode: 'set', value: '500' } }), { canEditPrice: false })).toEqual([])
  })
})

describe('groupBulkUpdates and runBulkUpdates', () => {
  it('products with identical updates share one request; percentages give each its own', () => {
    expect(groupBulkUpdates(planBulkEdit(P, c({ shelf_label: 'Z' })))).toEqual([{ updates: { shelf_label: 'Z' }, ids: ['a', 'b', 'c'] }])
    expect(groupBulkUpdates(planBulkEdit(P.slice(0, 2), c({ price: { mode: 'increase', value: '10' } }), PRICES))).toHaveLength(2)
  })
  it('returns what was saved and what failed, never throws, and reports progress', async () => {
    const updateMany = vi.fn(async (ids, updates) => {
      if (ids.includes('b')) throw new Error('Supabase error (400): nope')
      return ids.map((id) => ({ id, ...updates }))
    })
    const progress = []
    const r = await runBulkUpdates([{ ids: ['a', 'c'], updates: { shelf_label: 'Z' } }, { ids: ['b'], updates: { price: 1 } }], updateMany, { onProgress: (d, t) => progress.push([d, t]) })
    expect(r.saved.map((x) => x.id)).toEqual(['a', 'c'])
    expect(r.failed).toEqual([{ ids: ['b'], updates: { price: 1 }, message: 'Supabase error (400): nope' }])
    expect(r.total).toBe(3)
    expect(progress.at(-1)).toEqual([3, 3])
  })
})

describe('keptReasonText', () => {
  it('explains why a product was kept', () => {
    expect(keptReasonText(['shop_orders', 'reviews'])).toBe('in online shop orders, has customer reviews')
  })
})
