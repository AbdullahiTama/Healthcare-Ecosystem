import { stockStatus, businessTypeLabel, sellerLine } from './productCardModel'

describe('stockStatus', () => {
  it('is "in" when stock is above the reorder level', () => {
    expect(stockStatus({ stock: 25, reorder_level: 10 })).toBe('in')
  })

  it('is "low" at or below the reorder level', () => {
    expect(stockStatus({ stock: 10, reorder_level: 10 })).toBe('low')
    expect(stockStatus({ stock: 3, reorder_level: 10 })).toBe('low')
  })

  it('is "in" when the seller set no reorder level', () => {
    expect(stockStatus({ stock: 3, reorder_level: null })).toBe('in')
    expect(stockStatus({ stock: 3 })).toBe('in')
  })

  it('is "out" when nothing is left, whatever the reorder level', () => {
    expect(stockStatus({ stock: 0, reorder_level: 10 })).toBe('out')
    expect(stockStatus({ stock: -2 })).toBe('out')
  })

  it('shows no badge when stock is unknown', () => {
    expect(stockStatus({ stock: null })).toBeNull()
    expect(stockStatus(undefined)).toBeNull()
  })
})

describe('businessTypeLabel', () => {
  it('title-cases the stored type', () => {
    expect(businessTypeLabel('pharmacy')).toBe('Pharmacy')
    expect(businessTypeLabel('medical_supplier')).toBe('Medical supplier')
    expect(businessTypeLabel('DISTRIBUTOR')).toBe('Distributor')
  })

  it('returns null for a missing type', () => {
    expect(businessTypeLabel(null)).toBeNull()
    expect(businessTypeLabel('  ')).toBeNull()
  })
})

describe('sellerLine', () => {
  it('joins the type and the distance', () => {
    expect(sellerLine('pharmacy', '1.2km away')).toBe('Pharmacy • 1.2km away')
  })

  it('shows whichever part exists', () => {
    expect(sellerLine('pharmacy', null)).toBe('Pharmacy')
    expect(sellerLine(null, '850m away')).toBe('850m away')
  })

  it('is null when there is nothing to show', () => {
    expect(sellerLine(null, null)).toBeNull()
  })
})
