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
  whatsappLink,
  telLink,
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

  it('whatsappLink returns null without a contact', () => {
    expect(whatsappLink(null, 'hi')).toBeNull()
    expect(whatsappLink('', 'hi')).toBeNull()
  })

  it('whatsappLink normalises Nigerian 080 and 234 numbers', () => {
    expect(whatsappLink('08012345678', 'Hello')).toBe('https://wa.me/2348012345678?text=Hello')
    expect(whatsappLink('2348012345678', 'hi')).toBe('https://wa.me/2348012345678?text=hi')
    expect(whatsappLink('+2348012345678', 'hi')).toBe('https://wa.me/2348012345678?text=hi')
    expect(whatsappLink('8012345678', 'hi')).toBe('https://wa.me/2348012345678?text=hi')
  })

  it('whatsappLink encodes the message', () => {
    expect(whatsappLink('08012345678', 'Hi "Pharmacy", price?')).toBe('https://wa.me/2348012345678?text=Hi%20%22Pharmacy%22%2C%20price%3F')
  })

  it('telLink returns null without a contact', () => {
    expect(telLink(null)).toBeNull()
    expect(telLink('')).toBeNull()
    expect(telLink('   ')).toBeNull()
  })

  it('telLink normalises Nigerian numbers like whatsappLink', () => {
    expect(telLink('08012345678')).toBe('tel:+2348012345678')
    expect(telLink('2348012345678')).toBe('tel:+2348012345678')
    expect(telLink('+2348012345678')).toBe('tel:+2348012345678')
    expect(telLink('8012345678')).toBe('tel:+2348012345678')
  })

  it('telLink strips formatting from numbers', () => {
    expect(telLink('+234 (801) 234-5678')).toBe('tel:+2348012345678')
  })
})