import { describe, it, expect } from 'vitest'
import { draftLines, addLine, editTotals, validateEdit, toPayload, describeCorrection, lineErrors } from './saleEdit'

// 750 sale, paid 1000 cash (250 change handed back): money received is 750.
const sale = { total: 750, amount_paid: 1000, items: JSON.stringify(JSON.stringify([
  { id: 'a', name: 'Paracetamol', price: 250, qty: 2, batch_id: 'b1' }, { id: 'b', name: 'Amoxil', price: 250, qty: 1 }])) }

describe('Owner sale edit arithmetic (mirrors edit_sale)', () => {
  it('reads double-encoded items and keeps keys such as batch_id', () => {
    const l = draftLines(sale)
    expect(l).toHaveLength(2)
    expect(l[0]).toMatchObject({ id: 'a', batch_id: 'b1', qty: 2, price: 250 })
  })
  it('dropping lines leaves an amount to refund, not a negative balance', () => {
    const t = editTotals(draftLines(sale).slice(0, 1), 0, sale)
    expect(t).toMatchObject({ subtotal: 500, total: 500, paid: 750, balance: 0, overpaid: 250 })
  })
  it('a higher total leaves a balance owed (credit) against money already received', () => {
    const lines = draftLines(sale).map((l) => ({ ...l, qty: l.qty + 2 }))
    expect(editTotals(lines, 0, sale)).toMatchObject({ subtotal: 1750, total: 1750, balance: 1000, overpaid: 0 })
  })
  it('applies the discount and rejects one above the subtotal', () => {
    expect(editTotals(draftLines(sale), 50, sale).total).toBe(700)
    expect(editTotals(draftLines(sale), 5000, sale).discountError).toMatch(/Discount/)
  })
  it('works in kobo without float drift', () => {
    expect(editTotals([{ qty: 3, price: 0.1 }], 0, { total: 0.3, amount_paid: 0.3 }).total).toBe(0.3)
  })
  it('adding an existing product bumps its quantity; a new one is appended', () => {
    const lines = draftLines(sale)
    expect(addLine(lines, { id: 'a', name: 'Paracetamol', price: 999 })[0].qty).toBe(3)
    const added = addLine(lines, { id: 'c', name: 'Vit C', price: '120' })
    expect(added[2]).toEqual({ id: 'c', name: 'Vit C', price: 120, qty: 1 })
  })
  it('validates lines, discount and reason before saving', () => {
    const lines = draftLines(sale)
    expect(validateEdit([], 0, sale, 'because')).toMatch(/at least one product/)
    expect(validateEdit([{ ...lines[0], qty: '1.5' }], 0, sale, 'because')).toMatch(/whole number/)
    expect(validateEdit([{ ...lines[0], price: '-1' }], 0, sale, 'because')).toMatch(/Price/)
    expect(validateEdit(lines, 0, sale, ' ')).toMatch(/reason/)
    expect(validateEdit(lines, 0, sale, 'typo at the till')).toBeNull()
    expect(lineErrors({ name: '', qty: 1, price: 1 })).toMatch(/Name/)
  })
  it('sends numbers, not the strings typed into the inputs', () => {
    expect(toPayload([{ id: 'a', name: 'x', qty: '3', price: '12.5' }])).toEqual([{ id: 'a', name: 'x', qty: 3, price: 12.5 }])
  })
  it('describes audit rows for the history list', () => {
    expect(describeCorrection({ action: 'sale.edited', metadata: { before: { total: 750 }, after: { total: 500 }, reason: 'typo' } }))
      .toEqual({ label: 'Edited', detail: 'Total 750 → 500', reason: 'typo' })
    expect(describeCorrection({ action: 'sale.refunded', metadata: { amount: 100, method: 'Cash', reason: 'damaged' } }).detail).toBe('100 by Cash')
    expect(describeCorrection({ action: 'sale.deleted', metadata: { reversed_payments: 750, reason: 'dup' } }).detail).toMatch(/750/)
  })
})
