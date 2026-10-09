import { describe, it, expect } from 'vitest'
import {
  normalizeName, normalizePhone, normalizeAddress, websiteHost, isValidPhone, isValidEmail,
  isValidWebsite, safeWebsiteUrl, isWithinNigeria, isValidLatLng, toNumberOrNull,
} from '../services/normalize'
import { haversineKm, boundingBox, formatDistance, withDistance } from '../services/distance'
import { canonicalState } from '../services/constants'

describe('normalizeName', () => {
  it('collapses legal suffixes, case and punctuation', () => {
    expect(normalizeName('Alpha Pharmacy Ltd.')).toBe('alpha pharmacy')
    expect(normalizeName('ALPHA  PHARMACY LIMITED')).toBe('alpha pharmacy')
    expect(normalizeName("Alpha's Pharmacy & Stores Nig. Ltd")).toBe('alphas pharmacy stores')
  })
  it('strips diacritics', () => expect(normalizeName('Clínica Médica')).toBe('clinica medica'))
  it('keeps a name that is entirely suffix words', () => expect(normalizeName('Nigeria Enterprises')).toBe('nigeria enterprises'))
  it('returns empty for empty input', () => expect(normalizeName('  ')).toBe(''))
})

describe('normalizePhone', () => {
  it('maps every Nigerian spelling to the national form', () => {
    expect(normalizePhone('+234 803 123 4567')).toBe('08031234567')
    expect(normalizePhone('2348031234567')).toBe('08031234567')
    expect(normalizePhone('8031234567')).toBe('08031234567')
    expect(normalizePhone('0803-123-4567')).toBe('08031234567')
    expect(normalizePhone('00234 803 123 4567')).toBe('08031234567')
  })
  it('keeps foreign numbers as digits', () => expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958'))
  it('is empty for junk', () => expect(normalizePhone('n/a')).toBe(''))
})

describe('validators', () => {
  it('phone', () => {
    expect(isValidPhone('')).toBe(true)
    expect(isValidPhone('0803 123 4567')).toBe(true)
    expect(isValidPhone('call me')).toBe(false)
    expect(isValidPhone('123')).toBe(false)
  })
  it('email', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('')).toBe(true)
  })
  it('website host + safety', () => {
    expect(websiteHost('https://www.Alpha.com/contact')).toBe('alpha.com')
    expect(websiteHost('alpha.com')).toBe('alpha.com')
    expect(websiteHost('javascript:alert(1)')).toBe('')
    expect(isValidWebsite('not a url')).toBe(false)
    expect(safeWebsiteUrl('javascript:alert(1)')).toBeNull()
    expect(safeWebsiteUrl('alpha.com')).toBe('https://alpha.com')
  })
  it('coordinates', () => {
    expect(toNumberOrNull('')).toBeNull()
    expect(toNumberOrNull('abc')).toBeNaN()
    expect(isValidLatLng(91, 0)).toBe(false)
    expect(isWithinNigeria(6.5, 3.4)).toBe(true)
    expect(isWithinNigeria(3.4, 6.5)).toBe(false) // swapped
  })
  it('addresses expand abbreviations', () => {
    expect(normalizeAddress('12, Herbert Macaulay Rd.')).toBe('12 herbert macaulay road')
  })
  it('states', () => {
    expect(canonicalState('Lagos State')).toBe('Lagos')
    expect(canonicalState('fct')).toBe('Federal Capital Territory')
    expect(canonicalState('Atlantis')).toBeNull()
  })
})

describe('distance', () => {
  it('haversine: Lagos Island to Ikeja is roughly 15–20 km, zero for same point', () => {
    expect(haversineKm(6.5, 3.4, 6.5, 3.4)).toBe(0)
    const d = haversineKm(6.45, 3.4, 6.6, 3.35)
    expect(d).toBeGreaterThan(15)
    expect(d).toBeLessThan(20)
  })
  it('boundingBox contains every point within the radius', () => {
    const b = boundingBox(6.5, 3.4, 5)
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180
      const lat = 6.5 + (4.9 / 111.19) * Math.sin(rad)
      const lng = 3.4 + (4.9 / (111.19 * Math.cos((6.5 * Math.PI) / 180))) * Math.cos(rad)
      expect(lat).toBeGreaterThanOrEqual(b.minLat)
      expect(lat).toBeLessThanOrEqual(b.maxLat)
      expect(lng).toBeGreaterThanOrEqual(b.minLng)
      expect(lng).toBeLessThanOrEqual(b.maxLng)
    }
  })
  it('formats', () => {
    expect(formatDistance(0.43)).toBe('430 m')
    expect(formatDistance(2.34)).toBe('2.3 km')
    expect(formatDistance(14.6)).toBe('15 km')
    expect(formatDistance(null)).toBe('')
  })
  it('withDistance leaves un-geocoded rows without a distance', () => {
    const r = withDistance([{ id: 1, latitude: null, longitude: null }, { id: 2, latitude: 6.5, longitude: 3.4 }], 6.5, 3.4)
    expect(r[0].distance_km).toBeNull()
    expect(r[1].distance_km).toBe(0)
  })
})
