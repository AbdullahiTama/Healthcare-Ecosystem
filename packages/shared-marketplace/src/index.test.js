import { describe, it, expect } from 'vitest'
import {
  SALE_TYPES,
  SALE_TYPE_LABELS,
  UNITS_BY_SALE_TYPE,
  ALL_UNITS,
  unitsForSaleType,
  isUnitValidForSaleType,
  unitLabel,
  saleUnitError,
} from './index.js'

describe('shared marketplace rules', () => {
  it('defines the three supported sale types', () => {
    expect(SALE_TYPES).toEqual(['retail', 'wholesale', 'distributor'])
    expect(SALE_TYPE_LABELS.retail).toBe('Retail')
  })

  it('maps the allowed units per sale type', () => {
    expect(UNITS_BY_SALE_TYPE.retail).toEqual(['piece', 'card', 'sachet', 'bottle'])
    expect(UNITS_BY_SALE_TYPE.wholesale).toEqual(['pack', 'box', 'roll', 'bottle'])
    expect(UNITS_BY_SALE_TYPE.distributor).toEqual(['carton', 'roll'])
  })

  it('lists every used unit exactly once', () => {
    const unique = new Set(ALL_UNITS)
    expect(unique.size).toBe(ALL_UNITS.length)
    expect(ALL_UNITS).toContain('piece')
    expect(ALL_UNITS).toContain('carton')
  })

  it('returns allowed units for a sale type', () => {
    expect(unitsForSaleType('wholesale')).toContain('box')
    expect(unitsForSaleType('unknown')).toEqual([])
  })

  it('accepts a unit inside the allowed set and rejects everything else', () => {
    expect(isUnitValidForSaleType('bottle', 'retail')).toBe(true)
    expect(isUnitValidForSaleType('carton', 'retail')).toBe(false)
    expect(isUnitValidForSaleType('carton', 'distributor')).toBe(true)
    expect(isUnitValidForSaleType('piece', 'wholesale')).toBe(false)
    expect(isUnitValidForSaleType('box', 'nope')).toBe(false)
  })

  it('capitalises unit labels for display', () => {
    expect(unitLabel('carton')).toBe('Carton')
    expect(unitLabel('bottle')).toBe('Bottle')
  })

  it('produces the exact blocking error message', () => {
    expect(saleUnitError('carton', 'retail')).toBe('Carton is not valid for Retail.')
    expect(saleUnitError('card', 'distributor')).toBe('Card is not valid for Distributor.')
  })
})