import { describe, it, expect } from 'vitest'
import { computeInventoryStats } from './inventoryStats.js'

const product = (over = {}) => ({ name: 'Item', category: 'Medicines', price: 0, cost_price: 0, stock: 0, ...over })

describe('computeInventoryStats', () => {
  it('derives profit and margin from stock value and cost', () => {
    const stats = computeInventoryStats([
      product({ price: 1500, cost_price: 900, stock: 10 }), // value 15000, cost 9000
      product({ price: 500, cost_price: 400, stock: 20 }),  // value 10000, cost 8000
    ])
    expect(stats.stockValue).toBe(25000)
    expect(stats.costValue).toBe(17000)
    expect(stats.profit).toBe(8000)
    expect(stats.margin).toBeCloseTo(32)
  })

  it('reports a negative profit and margin when stock is priced below cost', () => {
    const stats = computeInventoryStats([product({ price: 400, cost_price: 500, stock: 10 })])
    expect(stats.profit).toBe(-1000)
    expect(stats.margin).toBeCloseTo(-25)
  })

  it('leaves margin undefined rather than dividing by zero when nothing is in stock', () => {
    const stats = computeInventoryStats([product({ price: 1500, cost_price: 900, stock: 0 })])
    expect(stats.stockValue).toBe(0)
    expect(stats.profit).toBe(0)
    expect(stats.margin).toBeNull()
  })

  it('counts stocked items with no cost price so the profit figure can be qualified', () => {
    const stats = computeInventoryStats([
      product({ price: 1000, cost_price: 0, stock: 5 }),
      product({ price: 1000, cost_price: null, stock: 5 }),
      product({ price: 1000, cost_price: 600, stock: 5 }),
      product({ price: 1000, cost_price: 0, stock: 0 }), // out of stock — contributes nothing
    ])
    expect(stats.missingCost).toBe(2)
    expect(stats.profit).toBe(12000) // 15000 value - 3000 cost
  })

  it('excludes services from every stock money figure', () => {
    const stats = computeInventoryStats([
      product({ category: 'Services', price: 5000, cost_price: 0, stock: 999 }),
      product({ price: 1000, cost_price: 600, stock: 10 }),
    ])
    expect(stats.stockValue).toBe(10000)
    expect(stats.costValue).toBe(6000)
    expect(stats.profit).toBe(4000)
    expect(stats.missingCost).toBe(0)
  })

  it('honours the legacy `cat` field as well as `category`', () => {
    const stats = computeInventoryStats([{ name: 'Consult', cat: 'Services', price: 5000, stock: 999 }])
    expect(stats.stockValue).toBe(0)
    expect(stats.margin).toBeNull()
  })

  it('splits low stock from out of stock and counts CareFind listings', () => {
    const stats = computeInventoryStats([
      product({ name: 'Low', stock: 3, reorder_level: 5 }),
      product({ name: 'Low default', stock: 4 }), // no reorder_level → default 5
      product({ name: 'Fine', stock: 50, reorder_level: 5 }),
      product({ name: 'Out', stock: 0 }),
      product({ name: 'Hidden', stock: 10, list_on_carefind: false }),
    ])
    expect(stats.lowStock.map(p => p.name)).toEqual(['Low', 'Low default'])
    expect(stats.outOfStock.map(p => p.name)).toEqual(['Out'])
    expect(stats.onCareFind).toBe(3) // Low, Low default, Fine — not Out, not Hidden
  })

  it('handles an empty list', () => {
    expect(computeInventoryStats([])).toMatchObject({ stockValue: 0, costValue: 0, profit: 0, margin: null, missingCost: 0, onCareFind: 0 })
    expect(computeInventoryStats().lowStock).toEqual([])
  })
})
