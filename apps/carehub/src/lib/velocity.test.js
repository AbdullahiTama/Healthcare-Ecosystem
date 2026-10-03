import { describe, it, expect } from 'vitest'
import { parseSaleItems, classifySalesVelocity } from './velocity.js'

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

describe('classifySalesVelocity', () => {
  const products = [
    p('fast', 'Fast Mover', 50),
    p('mid', 'Steady Item', 20),
    p('slow', 'Dust Collector', 10),
    p('out', 'Out of Stock', 0),
    p('svc', 'Consultation', 999),
  ]
  products[4].category = 'Services'
  const sales = [
    arraySale(1, [{ id: 'fast', qty: 6 }]),
    stringSale(3, [{ id: 'fast', qty: '5' }]), // 11 total → fast
    arraySale(5, [{ id: 'mid', qty: 2 }]),
    arraySale(10, [{ id: 'slow', qty: 0 }]), // sold nothing
  ]

  it('classifies stocked products by units sold in the window', () => {
    const { fast, medium, slow } = classifySalesVelocity(products, sales, { days: 30 })
    expect(fast.map(x => x.id)).toEqual(['fast'])
    expect(fast[0].units).toBe(11)
    expect(medium.map(x => x.id)).toEqual(['mid'])
    expect(slow.map(x => x.id)).toEqual(['slow'])
  })

  it('never classifies out-of-stock or service rows', () => {
    const all = classifySalesVelocity(products, sales, { days: 30 })
    const ids = [...all.fast, ...all.medium, ...all.slow].map(x => x.id)
    expect(ids).not.toContain('out')
    expect(ids).not.toContain('svc')
  })

  it('ignores sales older than the window', () => {
    const old = [arraySale(90, [{ id: 'slow', qty: 99 }])]
    const { slow, fast } = classifySalesVelocity(products, old, { days: 30 })
    expect(fast).toHaveLength(0)
    expect(slow.map(x => x.id)).toContain('slow')
  })

  it('handles line items keyed by product_id as well as id', () => {
    const salesAlt = [arraySale(2, [{ product_id: 'mid', qty: 9 }])]
    const { medium } = classifySalesVelocity(products, salesAlt, { days: 30 })
    expect(medium[0].units).toBe(9)
  })

  it('returns empty groups when there are no sales at all', () => {
    const all = classifySalesVelocity(products, [], { days: 30 })
    expect(all.fast).toHaveLength(0)
    expect(all.medium).toHaveLength(0)
    expect(all.slow.map(x => x.id)).toEqual(['fast', 'mid', 'slow'])
  })
})
