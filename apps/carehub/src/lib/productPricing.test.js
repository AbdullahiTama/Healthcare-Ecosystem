import { describe, it, expect } from 'vitest'
import { retailPrice, wholesalePrice, hasBothPrices, hasAnyPrice, priceOptions, priceFor, referencePrice, priceSummary, parseOptionalPrice } from './productPricing'

const both = { price: 500, wholesale_price: 420 }
const retailOnly = { price: 500, wholesale_price: null }
const wholesaleOnly = { price: 0, wholesale_price: 420 }
const neither = { price: 0 }

describe('productPricing', () => {
  it('treats 0, blank and null as "not entered"', () => {
    expect(retailPrice({ price: 0 })).toBeNull()
    expect(retailPrice({ price: '' })).toBeNull()
    expect(wholesalePrice({ wholesale_price: null })).toBeNull()
    expect(wholesalePrice({})).toBeNull()
    expect(retailPrice({ price: '750' })).toBe(750)
  })

  it('lists only the prices that are set, retail first', () => {
    expect(priceOptions(both).map(o => [o.tier, o.price])).toEqual([['retail', 500], ['wholesale', 420]])
    expect(priceOptions(retailOnly).map(o => o.tier)).toEqual(['retail'])
    expect(priceOptions(wholesaleOnly).map(o => o.tier)).toEqual(['wholesale'])
  })

  it('keeps a product with no price sellable at 0, as before', () => {
    expect(priceOptions(neither)).toEqual([{ tier: 'retail', label: 'Retail', price: 0 }])
    expect(hasAnyPrice(neither)).toBe(false)
  })

  it('picks the requested tier, or the price the product has', () => {
    expect(priceFor(both, 'wholesale')).toEqual({ tier: 'wholesale', price: 420 })
    expect(priceFor(both, 'retail')).toEqual({ tier: 'retail', price: 500 })
    expect(priceFor(retailOnly, 'wholesale')).toEqual({ tier: 'retail', price: 500 })
    expect(priceFor(wholesaleOnly, 'retail')).toEqual({ tier: 'wholesale', price: 420 })
    expect(priceFor(neither, 'wholesale')).toEqual({ tier: 'retail', price: 0 })
  })

  it('knows when both prices are available', () => {
    expect(hasBothPrices(both)).toBe(true)
    expect(hasBothPrices(retailOnly)).toBe(false)
    expect(hasBothPrices(wholesaleOnly)).toBe(false)
  })

  it('uses retail, else wholesale, as the single reference figure', () => {
    expect(referencePrice(both)).toBe(500)
    expect(referencePrice(wholesaleOnly)).toBe(420)
    expect(referencePrice(neither)).toBe(0)
  })

  it('names only the prices that are set', () => {
    expect(priceSummary(retailOnly)).toBe('₦500')
    expect(priceSummary(wholesaleOnly)).toBe('Wholesale ₦420')
    expect(priceSummary(both)).toBe('Retail ₦500 · Wholesale ₦420')
    expect(priceSummary(neither)).toBe('₦0')
  })

  it('parses optional prices from forms and spreadsheets', () => {
    expect(parseOptionalPrice('')).toBeNull()
    expect(parseOptionalPrice('  ')).toBeNull()
    expect(parseOptionalPrice(undefined)).toBeNull()
    expect(parseOptionalPrice('1,250')).toBe(1250)
    expect(parseOptionalPrice('₦ 300')).toBe(300)
    expect(parseOptionalPrice(0)).toBe(0)
    expect(parseOptionalPrice('abc')).toBeNaN()
    expect(parseOptionalPrice('-5')).toBeNaN()
  })
})
