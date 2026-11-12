// Cost price at the POS: the rules behind the cost and margin shown to users allowed to see them (costView.js).
import { describe, it, expect, beforeEach } from 'vitest'
import { unitCost, marginPct, saleCostSummary, readShowCost, writeShowCost } from './costView'

describe('unit cost and margin', () => {
  it('a missing or zero cost is "not set", never free', () => {
    expect(unitCost({ cost_price: 450 })).toBe(450)
    expect(unitCost({ cost_price: '450.50' })).toBe(450.5)
    for (const p of [{}, { cost_price: 0 }, { cost_price: null }, { cost_price: 'x' }, null]) expect(unitCost(p)).toBeNull()
  })

  it('margin is on the selling price, in whole percent; a loss is negative', () => {
    expect(marginPct(1000, 600)).toBe(40)
    expect(marginPct(1000, 1200)).toBe(-20)
    expect(marginPct(1000, null)).toBeNull()
    expect(marginPct(0, 100)).toBeNull()
  })
})

describe('the sale at cost', () => {
  const costs = { a: 600, b: 50 }
  const costOf = (l) => costs[l.id] ?? null

  it('profit is what the customer pays less what the goods cost, to the kobo', () => {
    const cart = [{ id: 'a', price: 1000, qty: 2 }, { id: 'b', price: 100.1, qty: 3 }]
    expect(saleCostSummary(cart, costOf, 2300.3)).toEqual({ cost: 1350, profit: 950.3, marginPct: 41, missing: 0 })
  })

  it('a discount reduces the profit', () => {
    expect(saleCostSummary([{ id: 'a', price: 1000, qty: 1 }], costOf, 900)).toMatchObject({ profit: 300, marginPct: 33 })
  })

  it('selling below cost shows a loss', () => {
    expect(saleCostSummary([{ id: 'a', price: 500, qty: 1 }], costOf, 500)).toMatchObject({ profit: -100, marginPct: -20 })
  })

  it('lines without a cost are counted out of the estimate, with their share of the discount', () => {
    const cart = [{ id: 'a', price: 1000, qty: 1 }, { id: 'x', price: 1000, qty: 1 }]
    // 10% discount: the costed line brings in 900 of the 1,800 paid.
    expect(saleCostSummary(cart, costOf, 1800)).toEqual({ cost: 600, profit: 300, marginPct: 33, missing: 1 })
    expect(saleCostSummary([{ id: 'x', price: 10, qty: 1 }], costOf, 10)).toEqual({ cost: null, profit: null, marginPct: null, missing: 1 })
    expect(saleCostSummary([], costOf, 0)).toEqual({ cost: null, profit: null, marginPct: null, missing: 0 })
  })
})

describe('the cost switch', () => {
  beforeEach(() => localStorage.clear())
  it('starts shown; hiding is remembered per business and staff member', () => {
    expect(readShowCost('b1:owner')).toBe(true)
    writeShowCost('b1:owner', false)
    expect(readShowCost('b1:owner')).toBe(false)
    expect(readShowCost('b1:s2')).toBe(true)
    writeShowCost('b1:owner', true)
    expect(readShowCost('b1:owner')).toBe(true)
  })
  it('broken storage reads as shown (the default)', () => {
    localStorage.setItem('carehub_pos_hide_cost', '{oops')
    expect(readShowCost('b1:owner')).toBe(true)
  })
})
