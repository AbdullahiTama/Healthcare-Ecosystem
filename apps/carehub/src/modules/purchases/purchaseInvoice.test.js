import { describe, it, expect } from 'vitest'
import { purchaseItemsFromForm, purchaseLines } from './purchaseInvoice.js'

describe('purchaseItemsFromForm', () => {
  it('keeps each line\'s name, quantity, cost and optional details as numbers', () => {
    expect(purchaseItemsFromForm([{ name: ' Amoxil ', qty: '10', cost: '1200', sell: '', batch: ' B1 ', expiry: '2027-01-01', cat: 'Medicines' }]))
      .toEqual([{ name: 'Amoxil', qty: 10, cost: 1200, sell: null, batch: 'B1', expiry: '2027-01-01', cat: 'Medicines' }])
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
