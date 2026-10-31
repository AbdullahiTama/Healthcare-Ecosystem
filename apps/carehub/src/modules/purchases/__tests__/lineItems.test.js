import { describe, it, expect } from 'vitest'
import { blankItem, isBlankItem, findProductForEntry, applyProduct, itemProblems, isPastExpiry, groupLinesByProduct } from '../lineItems'

const products = [
  { id: 'p1', name: 'Amoxil 500mg', generic_name: 'Amoxicillin', category: 'Medicines', price: 1500, cost_price: 800, stock: 24, barcode: '6151100001' },
  { id: 'p2', name: 'Panadol Extra', generic_name: 'Paracetamol', category: 'Medicines', price: 900, cost_price: 0, stock: 0 },
]
const line = (o) => ({ ...blankItem(), ...o })

describe('purchase line items', () => {
  it('gives every blank line a distinct id', () => {
    expect(blankItem().id).not.toBe(blankItem().id)
    expect(isBlankItem(blankItem())).toBe(true)
    expect(isBlankItem(line({ qty: '3' }))).toBe(false)
  })

  it('matches a product by exact (normalised) name or barcode, never by generic name', () => {
    expect(findProductForEntry(products, '  amoxil 500MG ')?.id).toBe('p1')
    expect(findProductForEntry(products, '6151100001')?.id).toBe('p1')
    expect(findProductForEntry(products, 'Paracetamol')).toBeNull()
    expect(findProductForEntry(products, 'Amoxil')).toBeNull()
    expect(findProductForEntry(products, '')).toBeNull()
  })

  it('prefills prices and category from the product but leaves delivery facts alone', () => {
    const filled = applyProduct(line({ qty: '10', batch: 'B7', expiry: '2027-03-01' }), products[0])
    expect(filled).toMatchObject({ productId: 'p1', name: 'Amoxil 500mg', cost: '800', sell: '1500', cat: 'Medicines', qty: '10', batch: 'B7', expiry: '2027-03-01' })
    // A zero cost is left empty for the user to fill, not prefilled as "0".
    expect(applyProduct(line({}), products[1]).cost).toBe('')
  })

  it('reports missing or invalid fields on started lines only', () => {
    expect(itemProblems(blankItem())).toEqual({})
    expect(Object.keys(itemProblems(line({ name: 'X' })))).toEqual(['qty', 'cost'])
    expect(itemProblems(line({ name: 'X', qty: '2.5', cost: '10' })).qty).toMatch(/whole/i)
    expect(itemProblems(line({ qty: '4', cost: '10' })).name).toBeTruthy()
    expect(itemProblems(line({ name: 'X', qty: '4', cost: '10' }))).toEqual({})
  })

  it('requires a batch, and an expiry when tracked by expiry, for tracked products only', () => {
    const ready = line({ name: 'Insulin', qty: '4', cost: '900' })
    expect(itemProblems(ready, { tracking_mode: 'none' })).toEqual({})
    expect(itemProblems(ready, { tracking_mode: 'batch_only' })).toEqual({ batch: 'Batch number needed' })
    expect(itemProblems(ready, { tracking_mode: 'batch_expiry' })).toEqual({ batch: 'Batch number needed', expiry: 'Expiry date needed' })
    expect(itemProblems({ ...ready, batch: 'INS-1', expiry: '2027-01-31' }, { tracking_mode: 'batch_expiry' })).toEqual({})
  })

  it('flags an expiry date that has already passed', () => {
    expect(isPastExpiry(line({ expiry: '2026-01-01' }), '2026-10-30')).toBe(true)
    expect(isPastExpiry(line({ expiry: '2027-01-01' }), '2026-10-30')).toBe(false)
    expect(isPastExpiry(line({}), '2026-10-30')).toBe(false)
  })

  it('groups lines by product but keeps every line to receive on its own', () => {
    const resolve = (l) => products.find(p => p.id === l.productId) || null
    const groups = groupLinesByProduct([
      line({ productId: 'p1', name: 'Amoxil 500mg', qty: '10', cost: '800', batch: 'A1', expiry: '2027-01-01' }),
      line({ productId: 'p1', name: 'Amoxil 500mg', qty: '5', cost: '820', batch: 'A2', expiry: '2027-06-01' }),
      line({ name: 'New Syrup', qty: '3', cost: '400', sell: '700' }),
      line({ name: 'new  syrup', qty: '2', cost: '400' }),
    ], resolve)
    expect(groups).toHaveLength(2)
    const amox = groups.find(g => g.existing?.id === 'p1')
    expect(amox).toMatchObject({ qty: 15, cost: 820 })
    expect(amox.lines.map(({ qty, batch, expiry }) => ({ qty, batch, expiry }))).toEqual([
      { batch: 'A1', expiry: '2027-01-01', qty: 10 },
      { batch: 'A2', expiry: '2027-06-01', qty: 5 },
    ])
    const syrup = groups.find(g => !g.existing)
    expect(syrup).toMatchObject({ name: 'New Syrup', qty: 5, sell: 700 })
    expect(syrup.lines.map(l => [l.qty, l.batch])).toEqual([[3, null], [2, null]])
  })
})

describe('purchase line items: barcodes and edit limits', () => {
  it('a barcode matches its product exactly after trimming, never partially', async () => {
    const { findProductByBarcode, looksLikeBarcode } = await import('../lineItems')
    expect(findProductByBarcode(products, ' 6151100001 ')?.id).toBe('p1')
    expect(findProductByBarcode(products, '61511')).toBeNull()
    expect(looksLikeBarcode('8903882000125')).toBe(true)
    expect(looksLikeBarcode('B-12')).toBe(false)
    expect(looksLikeBarcode('1234567')).toBe(false)
  })

  it('picking a product retrieves its barcode; a typed one is kept for a product without', () => {
    expect(applyProduct(line({ barcode: '999' }), products[0]).barcode).toBe('6151100001')
    expect(applyProduct(line({ barcode: '999' }), products[1]).barcode).toBe('999')
  })

  it('a barcode that belongs to another product is a problem; the product\'s own is not', () => {
    const own = line({ productId: 'p1', name: 'Amoxil 500mg', qty: '1', cost: '5', barcode: '6151100001' })
    expect(itemProblems(own, products[0], { barcodeOwner: products[0] }).barcode).toBeUndefined()
    const other = line({ productId: 'p2', name: 'Panadol Extra', qty: '1', cost: '5', barcode: '6151100001' })
    expect(itemProblems(other, products[1], { barcodeOwner: products[0] }).barcode).toBe('Belongs to Amoxil 500mg')
  })

  it('when editing, the quantity cannot go below what is still in stock, unless the line is locked', () => {
    const l = line({ productId: 'p1', name: 'Amoxil 500mg', qty: '3', cost: '5' })
    expect(itemProblems(l, products[0], { minQty: 4 }).qty).toBe('Lowest is 4: the rest is already sold')
    expect(itemProblems(l, products[0], { minQty: 3 }).qty).toBeUndefined()
    expect(itemProblems(l, null, { minQty: 4, locked: true }).qty).toBeUndefined()
  })

  it('a group keeps the first barcode entered for its product', () => {
    const groups = groupLinesByProduct([
      line({ name: 'New thing', qty: '1', cost: '2', barcode: '' }),
      line({ name: 'new thing', qty: '2', cost: '2', barcode: '777' }),
    ], () => null)
    expect(groups).toHaveLength(1)
    expect(groups[0].barcode).toBe('777')
  })
})
