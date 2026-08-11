import { describe, it, expect } from 'vitest'
import {
  canShowPrice,
  productCoords,
  haversineMeters,
  formatDistance,
  distanceLabel,
saleTypeColor,
  SALE_TYPES,
  unitsForSaleType,
  isUnitValidForSaleType,
  whatsappLink,
} from './marketplace.js'

describe('canShowPrice', () => {
  it('shows a price when the seller has not hidden it and a price exists', () => {
    expect(canShowPrice({ price: 500 })).toBe(true)
    expect(canShowPrice({ price: 0, show_price: true })).toBe(true)
  })

  it('hides the price when show_price is false', () => {
    expect(canShowPrice({ price: 500, show_price: false })).toBe(false)
  })

  it('hides the price when the owning business hides all its prices', () => {
    expect(canShowPrice({ price: 500, businesses: { show_prices: false } })).toBe(false)
    expect(canShowPrice({ price: 500, businesses: { show_prices: true } })).toBe(true)
    expect(canShowPrice({ price: 500, businesses: null })).toBe(true)
  })

  it('hides the price when there is none, regardless of the toggle', () => {
    expect(canShowPrice({ show_price: true })).toBeFalsy()
    expect(canShowPrice(null)).toBeFalsy()
    expect(canShowPrice(undefined)).toBeFalsy()
  })
})

describe('productCoords', () => {
  it('prefers the product’s own coordinates', () => {
    expect(productCoords({ latitude: 6.5, longitude: 3.3, businesses: { latitude: 1, longitude: 1 } }))
      .toEqual({ lat: 6.5, lng: 3.3 })
  })

  it('falls back to the business coordinates', () => {
    expect(productCoords({ latitude: null, longitude: null, businesses: { latitude: 9.0, longitude: 7.5 } }))
      .toEqual({ lat: 9.0, lng: 7.5 })
  })

  it('returns null when neither product nor business has coordinates', () => {
    expect(productCoords({})).toBeNull()
    expect(productCoords(null)).toBeNull()
  })
})

describe('haversineMeters', () => {
  it('returns ~0 for the same coordinates', () => {
    expect(haversineMeters(6.5, 3.4, 6.5, 3.4)).toBeLessThan(1)
  })

  it('approximates 1 arc-minute of latitude (~1852 m) between two close points', () => {
    const meters = haversineMeters(6, 3, 6.016667, 3)
    expect(meters).toBeGreaterThan(1700)
    expect(meters).toBeLessThan(2000)
  })

  it('returns a realistic distance for a Lagos–Abuja pair (~560 km)', () => {
    const km = haversineMeters(6.5244, 3.3792, 9.0765, 7.3986) / 1000
    expect(km).toBeGreaterThan(500)
    expect(km).toBeLessThan(650)
  })
})

describe('formatDistance', () => {
  it('formats sub-kilometre distances in metres', () => {
    expect(formatDistance(820)).toBe('820 m away')
    expect(formatDistance(0)).toBe('0 m away')
  })

  it('formats kilometre distances to one decimal below 10 km', () => {
    expect(formatDistance(2400)).toBe('2.4 km away')
  })

  it('formats large distances as whole kilometres', () => {
    expect(formatDistance(15000)).toBe('15 km away')
  })

  it('returns null for missing or invalid meters', () => {
    expect(formatDistance(null)).toBeNull()
    expect(formatDistance(undefined)).toBeNull()
    expect(formatDistance(NaN)).toBeNull()
    expect(formatDistance(Infinity)).toBeNull()
  })
})

describe('distanceLabel', () => {
  const product = { latitude: 6.5, longitude: 3.4 }
  const userAt = { lat: 6.5, lng: 3.4 }

  it('returns null without a product location or user location', () => {
    expect(distanceLabel(null, userAt)).toBeNull()
    expect(distanceLabel(product, null)).toBeNull()
    expect(distanceLabel(product, { lat: null, lng: null })).toBeNull()
  })

  it('produces a short distance label for nearby listings', () => {
    expect(distanceLabel(product, userAt)).toMatch(/m away|km away/)
  })
})

describe('sale type rules (shared with CareHub)', () => {
  it('exposes the three supported sale types', () => {
    expect(SALE_TYPES).toEqual(['retail', 'wholesale', 'distributor'])
  })

  it('validates the shared unit matrix', () => {
    expect(unitsForSaleType('retail')).toContain('piece')
    expect(isUnitValidForSaleType('carton', 'distributor')).toBe(true)
    expect(isUnitValidForSaleType('piece', 'wholesale')).toBe(false)
  })
})

describe('saleTypeColor', () => {
  it('marks wholesale/distributor with the purple badge and retail teal', () => {
    expect(saleTypeColor('wholesale')).toBe('#7c3aed')
    expect(saleTypeColor('distributor')).toBe('#7c3aed')
    expect(saleTypeColor('retail')).toBe('#0E6F5A')
  })
})

describe('whatsappLink', () => {
  it('returns null without a contact', () => {
    expect(whatsappLink(null, 'hi')).toBeNull()
    expect(whatsappLink('', 'hi')).toBeNull()
  })

  it('rewrites Nigerian 080 numbers to +234', () => {
    const link = whatsappLink('08012345678', 'Hello')
    expect(link).toMatch(/^https:\/\/wa\.me\/2348012345678\?text=/)
    expect(decodeURIComponent(link)).toContain('?text=Hello')
  })

  it('rewrites bare digits without a country code', () => {
    expect(whatsappLink('1234567890', 'hi')).toContain('wa.me/2341234567890')
  })

  it('leaves an already-international number alone', () => {
    expect(whatsappLink('+2348012345678', 'hi')).toContain('wa.me/2348012345678')
    expect(whatsappLink('2348012345678', 'hi')).toContain('wa.me/2348012345678')
  })

  it('encodes the message', () => {
    const link = whatsappLink('08012345678', 'Hi "Pharmacy", price?')
    expect(decodeURIComponent(link)).toContain('Hi "Pharmacy", price?')
  })
})