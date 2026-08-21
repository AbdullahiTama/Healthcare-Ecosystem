import { describe, it, expect } from 'vitest'
import { haversineMeters, verifyPlaceMatch } from './geo.js'

describe('haversineMeters', () => {
  it('measures a known short distance accurately', () => {
    // One degree of longitude at the equator ≈ 111,195 m.
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(d).toBeGreaterThan(111000)
    expect(d).toBeLessThan(111400)
  })

  it('is zero for identical points and symmetric', () => {
    expect(haversineMeters({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 })).toBe(0)
    const ab = haversineMeters({ lat: 6.5, lng: 3.3 }, { lat: 6.6, lng: 3.4 })
    const ba = haversineMeters({ lat: 6.6, lng: 3.4 }, { lat: 6.5, lng: 3.3 })
    expect(ab).toBeCloseTo(ba, 6)
  })

  it('returns null for missing or non-numeric coordinates', () => {
    expect(haversineMeters(null, { lat: 0, lng: 0 })).toBeNull()
    expect(haversineMeters({ lat: 0, lng: 0 }, null)).toBeNull()
    expect(haversineMeters({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })).toBeNull()
    expect(haversineMeters({ lat: undefined, lng: 0 }, { lat: 0, lng: 0 })).toBeNull()
  })
})

describe('verifyPlaceMatch', () => {
  // Ikeja City Mall ↔ Ikeja General Hospital is roughly 2 km apart; the
  // airport and the mall are ~4 km apart. Points below are synthetic but in
  // the same ballpark of separation.
  const place = { lat: 6.5833, lng: 3.3333 }
  const nearbyGps = { lat: 6.5837, lng: 3.3339 } // ~80 m away
  const farGps = { lat: 6.6018, lng: 3.3517 }   // ~2.6 km away

  it('accepts a GPS fix within the default 500 m tolerance', () => {
    expect(verifyPlaceMatch(place, nearbyGps)).toBe(true)
  })

  it('rejects a GPS fix beyond tolerance', () => {
    expect(verifyPlaceMatch(place, farGps)).toBe(false)
  })

  it('honours a custom radius', () => {
    expect(verifyPlaceMatch(place, farGps, 5000)).toBe(true)
    expect(verifyPlaceMatch(place, farGps, 100)).toBe(false)
  })

  it('never verifies against unusable coordinates', () => {
    expect(verifyPlaceMatch(null, nearbyGps)).toBe(false)
    expect(verifyPlaceMatch(place, null)).toBe(false)
    expect(verifyPlaceMatch(place, { lat: NaN, lng: 3 })).toBe(false)
  })
})
