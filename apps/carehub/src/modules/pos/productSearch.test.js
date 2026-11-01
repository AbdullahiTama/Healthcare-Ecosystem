import { describe, it, expect } from 'vitest'
import { buildProductIndex, searchProducts, findByBarcode } from './productSearch'

// What the POS search finds. The screen draws only a page of the result
// (POS.search.test.jsx); this pins the matching, filters and order.

const P = [
  { id: 'a', name: 'Amoxicillin 500mg', generic_name: 'Amoxicillin', cat: 'Rx', price: 1200, stock: 20, barcode: ' 6201234567890 ' },
  { id: 'b', name: 'Paracetamol 500mg', generic_name: 'Paracetamol', cat: 'OTC', price: 300, stock: 0, barcode: '6209876543210' },
  { id: 'c', name: 'paracetamol syrup', genericName: 'Paracetamol', cat: 'OTC', price: 450, stock: 3, reorder_level: 5 },
  { id: 'd', name: 'Blood pressure check', cat: 'Services', category: 'Services', price: 1000 },
  { id: 'e', name: 'Vitamin C 10', cat: 'Supplements', price: 800, stock: 9, expiry_date: '2026-11-15' },
  { id: 'f', name: 'Vitamin C 9', cat: 'Supplements', price: 700, stock: 9, expiry_date: '2025-01-01' },
]
const index = buildProductIndex(P)
const NOW = new Date('2026-10-31T12:00:00Z').getTime()
const ids = (opts) => searchProducts(index, { now: NOW, ...opts }).sellable.map((p) => p.id)

describe('POS product search', () => {
  it('finds by name, generic name or barcode, case-insensitively', () => {
    expect(ids({ query: 'AMOX' })).toEqual(['a'])
    expect(ids({ query: 'paracetamol' })).toEqual(['c']) // b is out of stock
    expect(ids({ query: '62012345' })).toEqual(['a'])
  })

  it('matches every word in any order, but never across two fields', () => {
    expect(ids({ query: '500 amox' })).toEqual(['a'])
    expect(ids({ query: 'syrup paracetamol' })).toEqual(['c'])
    // "mg" is in the name and "Amoxicillin" in the generic name: both words match the product.
    expect(ids({ query: 'mg amoxicillin' })).toEqual(['a'])
    // A word made of the end of one field and the start of the next does not match.
    expect(ids({ query: '500mgamox' })).toEqual([])
  })

  it('lists goods without stock for the Out-of-stock sheet, not on the grid; services always sell', () => {
    const r = searchProducts(index, { query: 'para', now: NOW })
    expect(r.sellable.map((p) => p.id)).toEqual(['c'])
    expect(r.outOfStock.map((p) => p.id)).toEqual(['b'])
    expect(ids({ query: 'blood' })).toEqual(['d'])
  })

  it('applies category, stock and expiry filters', () => {
    expect(ids({ category: 'OTC' })).toEqual(['c'])
    expect(ids({ stockFilter: 'low' })).toEqual(['c'])
    expect(ids({ stockFilter: 'out' })).toEqual(['b'])
    expect(ids({ expiryFilter: 'expiring' })).toEqual(['e'])
    expect(ids({ expiryFilter: 'expired' })).toEqual(['f'])
  })

  it('keeps the catalogue in name order (numbers in natural order) and sorts by price on request', () => {
    expect(ids({})).toEqual(['a', 'd', 'c', 'f', 'e'])
    expect(ids({ sortBy: 'name_desc' })).toEqual(['e', 'f', 'c', 'd', 'a'])
    expect(ids({ sortBy: 'price_asc' })).toEqual(['c', 'f', 'e', 'd', 'a'])
    expect(ids({ sortBy: 'price_desc' })).toEqual(['a', 'd', 'e', 'f', 'c'])
  })

  it('finds a scanned barcode exactly, ignoring stray spaces', () => {
    expect(findByBarcode(index, '6201234567890').id).toBe('a')
    expect(findByBarcode(index, ' 6209876543210 ').id).toBe('b')
    expect(findByBarcode(index, '620123')).toBeNull()
    expect(findByBarcode(index, '')).toBeNull()
  })

  it('lists the categories once each, "All" first', () => {
    expect(index.categories).toEqual(['All', 'Rx', 'OTC', 'Services', 'Supplements'])
  })

  it('handles a pharmacy-sized catalogue without re-preparing it per search', () => {
    const big = Array.from({ length: 3200 }, (_, i) => ({ id: 'p' + i, name: `Product ${i} tablets`, cat: 'Rx', price: i, stock: i % 3 }))
    const bigIndex = buildProductIndex(big)
    const all = searchProducts(bigIndex, {})
    expect(all.sellable.length + all.outOfStock.length).toBe(3200)
    // Deleting back to a short query returns most of the catalogue, from the prepared list.
    expect(searchProducts(bigIndex, { query: 'pro' }).sellable.length).toBe(all.sellable.length)
    expect(searchProducts(bigIndex, { query: 'product 3199' }).sellable.map((p) => p.id)).toEqual(['p3199'])
  })
})
