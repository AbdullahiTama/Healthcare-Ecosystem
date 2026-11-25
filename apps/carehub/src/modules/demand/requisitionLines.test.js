import { describe, it, expect } from 'vitest'
import { savedLines, badCostLines, lineTotal, requisitionTotal, toSavedLine } from './requisitionLines'

const qty = (v) => parseFloat(v) || 0

describe('requisition lines: cost is optional', () => {
  const items = [
    { product_name: 'Paracetamol', quantity: '10', cost: '500', unit: 'pack' },
    { product_name: 'Augmentin 625', quantity: '5', cost: '', unit: 'pack' },
    { product_name: '  ', quantity: '1', cost: '100' },
  ]

  it('saves every line with a product name, with or without a cost', () => {
    expect(savedLines(items).map(i => i.product_name)).toEqual(['Paracetamol', 'Augmentin 625'])
  })

  it('saves a blank cost as no cost, never 0', () => {
    expect(toSavedLine(items[1])).toEqual({ product_name: 'Augmentin 625', quantity: '5', cost: '', unit: 'pack' })
    expect(toSavedLine(items[0]).cost).toBe(500)
  })

  it('totals only the lines that have a cost and counts the others', () => {
    expect(requisitionTotal(items, qty)).toEqual({ total: 5000, missing: 1 })
    expect(lineTotal(items[1], qty)).toBeNull()
  })

  it('reports a cost that is not a number instead of saving it', () => {
    expect(badCostLines([{ product_name: 'X', cost: 'abc' }, { product_name: 'Y', cost: '-1' }, { product_name: 'Z', cost: '' }])).toEqual(['X', 'Y'])
  })

  it('reads costs typed with ₦ and commas', () => {
    expect(toSavedLine({ product_name: 'X', cost: '₦1,200' }).cost).toBe(1200)
  })
})
