import { describe, it, expect } from 'vitest'
import { parseSaleItems, classifySalesVelocity, unitsSoldById, VELOCITY_GROUPS } from './velocity.js'

const p = (id, name, stock) => ({ id, name, stock, category: 'Medicines' })
// A sale whose items jsonb is a double-encoded STRING — the shape 51 of 54
// real rows had when measured (sql/20260804_sale_stock_movement.sql L75-84).
const stringSale = (daysAgo, items) => ({
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  items: JSON.stringify(JSON.stringify(items)),
})
const arraySale = (daysAgo, items) => ({
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  items,
})

describe('parseSaleItems', () => {
  it('unwraps double-encoded jsonb strings', () => {
    const items = parseSaleItems(JSON.stringify([{ id: 'p1', qty: '3' }]))
    expect(items).toEqual([{ id: 'p1', qty: 3 }])
  })

  it('passes real arrays through', () => {
    expect(parseSaleItems([{ product_id: 'p2', qty: 1 }])).toEqual([{ product_id: 'p2', qty: 1 }])
  })

  it('returns [] for nullish and garbage input instead of throwing', () => {
    expect(parseSaleItems(null)).toEqual([])
    expect(parseSaleItems(undefined)).toEqual([])
    expect(parseSaleItems('not json')).toEqual([])
    expect(parseSaleItems({ nested: 'object' })).toEqual([])
  })

  it('coerces string quantities and defaults missing ones to zero', () => {
    expect(parseSaleItems('[{"id":"p1","qty":"7"},{"id":"p2"}]')[0].qty).toBe(7)
    expect(parseSaleItems('[{"id":"p2"}]')[0].qty).toBe(0)
  })
})

describe('classifySalesVelocity: fast, steady, slow and not moving', () => {
  const products = [
    p('fast', 'Fast Mover', 50),
    p('steady', 'Steady Item', 20),
    p('slow', 'Slow Item', 15),
    p('none', 'Dust Collector', 10),
    p('soldout', 'Sold Out Fast', 0),
    p('empty', 'Nothing Here', 0),
    p('svc', 'Consultation', 999),
  ]
  products[6].category = 'Services'
  const sales = [
    arraySale(1, [{ id: 'fast', qty: 6 }]),
    stringSale(3, [{ id: 'fast', qty: '5' }]),        // 11 → fast
    arraySale(5, [{ id: 'steady', qty: 4 }]),         // 4 → steady
    arraySale(6, [{ id: 'slow', qty: 3 }]),           // 3 → slow
    arraySale(10, [{ id: 'none', qty: 0 }]),          // 0 → not moving
    arraySale(2, [{ id: 'soldout', qty: 12 }]),       // sold out, still a fast mover
    arraySale(4, [{ id: 'svc', qty: 50 }]),           // a service is never classified
  ]

  it('puts each product in its group by units sold in the window, with its stock', () => {
    const g = classifySalesVelocity(products, sales, { days: 30 })
    expect(g.fast.map(x => x.id)).toEqual(['soldout', 'fast'])
    expect(g.fast[1]).toEqual({ id: 'fast', name: 'Fast Mover', units: 11, stock: 50 })
    expect(g.steady.map(x => x.id)).toEqual(['steady'])
    expect(g.slow.map(x => x.id)).toEqual(['slow'])
    expect(g.none.map(x => x.id)).toEqual(['none'])
  })

  it('the band edges: 10 is fast, 9 and 4 are steady, 3 and 1 are slow, 0 is not moving', () => {
    const items = [10, 9, 4, 3, 1, 0]
    const prods = items.map((n) => p('u' + n, 'U' + n, 5))
    const g = classifySalesVelocity(prods, [arraySale(1, items.map((n) => ({ id: 'u' + n, qty: n })))], { days: 30 })
    expect(g.fast.map(x => x.units)).toEqual([10])
    expect(g.steady.map(x => x.units)).toEqual([9, 4])
    expect(g.slow.map(x => x.units)).toEqual([3, 1])
    expect(g.none.map(x => x.units)).toEqual([0])
  })

  it('leaves out services, and products that neither sold nor have stock', () => {
    const g = classifySalesVelocity(products, sales, { days: 30 })
    const ids = [...g.fast, ...g.steady, ...g.slow, ...g.none].map(x => x.id)
    expect(ids).not.toContain('svc')
    expect(ids).not.toContain('empty')
  })

  it('ignores sales older than the window', () => {
    const g = classifySalesVelocity(products, [arraySale(90, [{ id: 'none', qty: 99 }])], { days: 30 })
    expect(g.fast).toHaveLength(0)
    expect(g.none.map(x => x.id)).toContain('none')
  })

  it('handles line items keyed by product_id as well as id', () => {
    expect(unitsSoldById([arraySale(2, [{ product_id: 'steady', qty: 9 }])])).toEqual({ steady: 9 })
    expect(classifySalesVelocity(products, [arraySale(2, [{ product_id: 'steady', qty: 9 }])]).steady[0].units).toBe(9)
  })

  it('with no sales, everything in stock is not moving, by stock (most first)', () => {
    const g = classifySalesVelocity(products, [], { days: 30 })
    expect(g.fast).toHaveLength(0)
    expect(g.steady).toHaveLength(0)
    expect(g.slow).toHaveLength(0)
    expect(g.none.map(x => x.id)).toEqual(['fast', 'steady', 'slow', 'none'])
  })

  it('names the four groups with the rule behind each', () => {
    expect(VELOCITY_GROUPS.map(g => g.key + ': ' + g.rule)).toEqual([
      'fast: 10+ units sold', 'steady: 4 to 9 units sold', 'slow: 1 to 3 units sold', 'none: none sold, still in stock'])
  })
})
