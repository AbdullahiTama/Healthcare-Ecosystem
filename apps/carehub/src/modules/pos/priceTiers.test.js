import { describe, it, expect } from 'vitest'
import { newCartLine, catalogPriceOf, isOverridden, withTier, applyPriceMode, catalogHasWholesale } from './priceTiers'

const BOTH = { id: 'b', name: 'Paracetamol', price: 500, wholesale_price: 420, stock: 10 }
const RETAIL = { id: 'r', name: 'Zinc', price: 300, wholesale_price: null, stock: 10 }
const WHOLESALE = { id: 'w', name: 'ORS carton', price: 0, wholesale_price: 9500, stock: 10 }
const byId = new Map([BOTH, RETAIL, WHOLESALE].map(p => [p.id, p]))

describe('newCartLine', () => {
  it('prices a line at the sale mode when the product has that price', () => {
    expect(newCartLine(BOTH, 'retail')).toMatchObject({ id: 'b', qty: 1, price: 500, price_tier: 'retail' })
    expect(newCartLine(BOTH, 'wholesale')).toMatchObject({ price: 420, price_tier: 'wholesale' })
  })

  it('always sells a one-price product at its only price', () => {
    expect(newCartLine(RETAIL, 'wholesale')).toMatchObject({ price: 300, price_tier: 'retail' })
    expect(newCartLine(WHOLESALE, 'retail')).toMatchObject({ price: 9500, price_tier: 'wholesale' })
  })

  it('keeps a product without any price at 0, as before', () => {
    expect(newCartLine({ id: 'x', price: 0 }, 'wholesale')).toMatchObject({ price: 0, price_tier: 'retail' })
  })
})

describe('switching a line', () => {
  it('moves a line between the two catalogue prices', () => {
    const line = newCartLine(BOTH, 'retail')
    expect(withTier(line, 'wholesale', BOTH)).toMatchObject({ price: 420, price_tier: 'wholesale' })
    expect(withTier(withTier(line, 'wholesale', BOTH), 'retail', BOTH)).toMatchObject({ price: 500, price_tier: 'retail' })
  })

  it('leaves a line alone when the product has no such price', () => {
    const line = newCartLine(RETAIL)
    expect(withTier(line, 'wholesale', RETAIL)).toBe(line)
  })

  it('compares a typed price with the line\'s own tier', () => {
    const w = newCartLine(BOTH, 'wholesale')
    expect(catalogPriceOf(w, BOTH)).toBe(420)
    expect(isOverridden(w, BOTH)).toBe(false)
    expect(isOverridden({ ...w, price: 400 }, BOTH)).toBe(true)
  })

  it('reads a line from before price tiers as retail', () => {
    expect(catalogPriceOf({ id: 'b', price: 500 }, BOTH)).toBe(500)
  })
})

describe('applyPriceMode', () => {
  it('reprices lines that have both prices and were not typed over', () => {
    const cart = [newCartLine(BOTH), { ...newCartLine(BOTH), id: 'b2' }, newCartLine(RETAIL), newCartLine(WHOLESALE)]
    cart[1] = { ...cart[1], price: 450 } // a one-off price typed by someone allowed to
    const next = applyPriceMode(cart, 'wholesale', new Map([...byId, ['b2', { ...BOTH, id: 'b2' }]]))
    expect(next.map(l => [l.id, l.price, l.price_tier])).toEqual([
      ['b', 420, 'wholesale'],
      ['b2', 450, 'retail'],
      ['r', 300, 'retail'],
      ['w', 9500, 'wholesale'],
    ])
    expect(next.map(l => l.qty)).toEqual([1, 1, 1, 1])
  })

  it('goes back to retail the same way', () => {
    const wholesale = applyPriceMode([newCartLine(BOTH)], 'wholesale', byId)
    expect(applyPriceMode(wholesale, 'retail', byId)[0]).toMatchObject({ price: 500, price_tier: 'retail' })
  })
})

it('shows the switch only when some product has a wholesale price', () => {
  expect(catalogHasWholesale([RETAIL])).toBe(false)
  expect(catalogHasWholesale([RETAIL, WHOLESALE])).toBe(true)
})
