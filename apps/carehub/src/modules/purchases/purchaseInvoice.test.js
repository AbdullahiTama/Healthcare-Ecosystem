import { describe, it, expect } from 'vitest'
import { purchaseItemsFromForm, purchaseLines, formFromPurchase, editItemsFromForm } from './purchaseInvoice.js'

describe('purchaseItemsFromForm', () => {
  it('keeps each line\'s name, quantity, cost and optional details as numbers', () => {
    expect(purchaseItemsFromForm([{ id: 'l1', productId: 'p-9', name: ' Amoxil ', qty: '10', cost: '1200', sell: '', batch: ' B1 ', expiry: '2027-01-01', barcode: ' 6001 ', cat: 'Medicines' }]))
      .toEqual([{ id: 'l1', product_id: 'p-9', name: 'Amoxil', qty: 10, cost: 1200, sell: null, batch: 'B1', expiry: '2027-01-01', barcode: '6001', cat: 'Medicines' }])
  })
  it('keeps the line id (the stock receipt key) and leaves an unlinked line\'s product empty', () => {
    expect(purchaseItemsFromForm([{ id: 'l2', productId: null, name: 'New', qty: '1', cost: '5', barcode: '' }])[0]).toMatchObject({ id: 'l2', product_id: null, barcode: null })
  })
})

describe('purchaseLines', () => {
  it('shows each saved line with its total', () => {
    const r = purchaseLines({ items: [{ name: 'Amoxil', qty: 10, cost: 1200, sell: 1500 }, { name: 'Panadol', qty: 3, cost: 33.335 }] })
    expect(r.itemised).toBe(true)
    expect(r.lines.map((l) => [l.name, l.qty, l.cost, l.total, l.sell])).toEqual([['Amoxil', 10, 1200, 12000, 1500], ['Panadol', 3, 33.335, 100.01, null]])
  })
  it('reads lines stored as a JSON string', () => {
    expect(purchaseLines({ items: '[{"name":"A","qty":2,"cost":5}]' }).lines[0].total).toBe(10)
  })
  it('an older purchase is one summary line from its stored totals', () => {
    const r = purchaseLines({ product_name: 'Amoxil, Panadol', quantity: 13, cost_price: 1046.15, total_cost: 13600, items: null })
    expect(r.itemised).toBe(false)
    expect(r.lines).toEqual([{ name: 'Amoxil, Panadol', qty: 13, cost: 1046.15, total: 13600, sell: null, batch: null, expiry: null }])
    expect(purchaseLines({ items: [] }).itemised).toBe(false)
  })
})

describe('purchaseLines: a summary purchase after an edit', () => {
  it('a single line flagged summary is still shown as the saved summary', () => {
    const r = purchaseLines({ total_cost: 600, items: [{ id: 'legacy-1', name: 'Gauze, Plaster', qty: 20, cost: 30, summary: true }] })
    expect(r.itemised).toBe(false)
    expect(r.lines[0]).toMatchObject({ name: 'Gauze, Plaster', qty: 20, total: 600 })
  })
})

describe('edit form', () => {
  const purchase = { supplier_name: ' Emzor ', supply_date: '2026-10-30', due_date: '', amount_paid: 1500, notes: 'inv 9', created_at: '2026-10-30T10:00:00Z' }
  const editItems = [{ id: 'l1', product_id: 'p1', name: 'Amoxil', qty: 10, cost: 120, sell: null, batch: null, expiry: '2027-01-31', barcode: '6001', cat: 'Medicines', received: 10, min_qty: 4 }]

  it('formFromPurchase turns the purchase and its lines into form strings', () => {
    expect(formFromPurchase(purchase, editItems)).toEqual({
      supplier: 'Emzor', supplyDate: '2026-10-30', dueDate: '', amountPaid: '1500', notes: 'inv 9',
      items: [{ id: 'l1', productId: 'p1', name: 'Amoxil', qty: '10', cost: '120', sell: '', batch: '', expiry: '2027-01-31', barcode: '6001', cat: 'Medicines' }],
    })
  })

  it('falls back to the recorded day when the supply date is missing', () => {
    expect(formFromPurchase({ ...purchase, supply_date: null }, []).supplyDate).toBe('2026-10-30')
  })

  it('editItemsFromForm sends numbers and nulls, keeping ids and products', () => {
    expect(editItemsFromForm(formFromPurchase(purchase, editItems).items)).toEqual([
      { id: 'l1', product_id: 'p1', name: 'Amoxil', qty: 10, cost: 120, sell: null, batch: null, expiry: '2027-01-31', barcode: '6001', cat: 'Medicines' },
    ])
  })
})
