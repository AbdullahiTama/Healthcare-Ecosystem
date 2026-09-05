import { describe, it, expect } from 'vitest'
import {
  haversineMeters, verifyPlaceMatch,
  formatDistance, categoryFromAmenity, verifyFacilityMatch,
  parseOverpass, rankFacilities, matchesCategory, FACILITY_VERIFY_THRESHOLD_M,
  FACILITY_CATEGORY, facilityVerification, FACILITY_VERIFICATION,
} from './geo.js'

// Issue #1 audit item 4. A rep-added facility is stored AT the rep's own GPS,
// so the distance check is circular — it must not produce a green tick.
describe('facilityVerification (three states, not a boolean)', () => {
  const gps = { lat: 6.5, lng: 3.3 }

  it('verifies a detected facility the rep is standing at', () => {
    expect(facilityVerification(gps, { lat: 6.5, lng: 3.3, source: 'detected' }))
      .toBe(FACILITY_VERIFICATION.VERIFIED)
  })

  it('refuses to verify a rep-added facility awaiting review, even at zero distance', () => {
    const typedHere = { lat: gps.lat, lng: gps.lng, source: 'rep_added', pendingReview: true }
    // The distance really is 0 — that is exactly why it proves nothing.
    expect(haversineMeters(gps, typedHere)).toBe(0)
    expect(facilityVerification(gps, typedHere)).toBe(FACILITY_VERIFICATION.PENDING)
  })

  it('verifies a rep-added facility once a manager has confirmed it', () => {
    expect(facilityVerification(gps, { lat: 6.5, lng: 3.3, source: 'rep_added', pendingReview: false }))
      .toBe(FACILITY_VERIFICATION.VERIFIED)
  })

  it('leaves a confirmed facility beyond the threshold unverified, not pending', () => {
    // ~1.1 km north — a genuine distance failure, not an unreviewed place.
    expect(facilityVerification(gps, { lat: 6.51, lng: 3.3, source: 'rep_added', pendingReview: false }))
      .toBe(FACILITY_VERIFICATION.UNVERIFIED)
  })

  it('reads as unverified when there is no GPS or no facility', () => {
    expect(facilityVerification(null, { lat: 6.5, lng: 3.3 })).toBe(FACILITY_VERIFICATION.UNVERIFIED)
    expect(facilityVerification(gps, null)).toBe(FACILITY_VERIFICATION.UNVERIFIED)
    expect(facilityVerification(gps, { lat: null, lng: null })).toBe(FACILITY_VERIFICATION.UNVERIFIED)
  })

  it('still honours an explicit threshold', () => {
    const far = { lat: 6.5018, lng: 3.3 } // ~200 m
    expect(facilityVerification(gps, far)).toBe(FACILITY_VERIFICATION.UNVERIFIED)
    expect(facilityVerification(gps, far, 300)).toBe(FACILITY_VERIFICATION.VERIFIED)
  })
})

describe('formatDistance', () => {
  it('renders whole metres under a kilometre', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(120)).toBe('120 m')
    expect(formatDistance(999)).toBe('999 m')
  })
  it('renders one-decimal kilometres at or past a kilometre', () => {
    expect(formatDistance(1400)).toBe('1.4 km')
    expect(formatDistance(12300)).toBe('12.3 km')
    expect(formatDistance(1000)).toBe('1.0 km')
  })
  it('returns an empty string for non-finite input', () => {
    expect(formatDistance(null)).toBe('')
    expect(formatDistance(NaN)).toBe('')
    expect(formatDistance(undefined)).toBe('')
  })
})

describe('categoryFromAmenity', () => {
  it('maps the named OSM amenities onto app categories', () => {
    expect(categoryFromAmenity('hospital')).toBe(FACILITY_CATEGORY.HOSPITAL)
    expect(categoryFromAmenity('pharmacy')).toBe(FACILITY_CATEGORY.PHARMACY)
    expect(categoryFromAmenity('clinic')).toBe(FACILITY_CATEGORY.CLINIC)
    expect(categoryFromAmenity('doctors')).toBe(FACILITY_CATEGORY.CLINIC)
    // Primary health facilities are now distinct from generic clinics
    expect(categoryFromAmenity('health_post')).toBe(FACILITY_CATEGORY.PRIMARY)
    expect(categoryFromAmenity('dispensary')).toBe(FACILITY_CATEGORY.PRIMARY)
    expect(categoryFromAmenity('birthing_center')).toBe(FACILITY_CATEGORY.PRIMARY)
    expect(categoryFromAmenity('dentist')).toBe(FACILITY_CATEGORY.DENTAL)
  })
  it('maps expanded healthcare facility categories (Manufacturer/Importer fix)', () => {
    expect(categoryFromAmenity('laboratory')).toBe(FACILITY_CATEGORY.LABORATORY)
    expect(categoryFromAmenity('physiotherapist')).toBe(FACILITY_CATEGORY.PHYSIO)
    expect(categoryFromAmenity('optician')).toBe(FACILITY_CATEGORY.EYE)
    expect(categoryFromAmenity('beauty')).toBe(FACILITY_CATEGORY.COSMETICS)
    expect(categoryFromAmenity('aesthetic')).toBe(FACILITY_CATEGORY.AESTHETIC_CLINIC)
    expect(categoryFromAmenity('medical_centre')).toBe(FACILITY_CATEGORY.MEDICAL_CENTRE)
    expect(categoryFromAmenity('specialist')).toBe(FACILITY_CATEGORY.SPECIALIST_CLINIC)
  })
  it('falls back to Other for anything unrecognised or missing', () => {
    expect(categoryFromAmenity('vaccination_centre')).toBe(FACILITY_CATEGORY.OTHER)
    expect(categoryFromAmenity('')).toBe(FACILITY_CATEGORY.OTHER)
    expect(categoryFromAmenity(null)).toBe(FACILITY_CATEGORY.OTHER)
  })
})

describe('verifyFacilityMatch (distance-only, never name match)', () => {
  const facility = { lat: 6.5833, lng: 3.3333 }
  const onSite = { lat: 6.5837, lng: 3.3339 }   // ~80 m away
  const far = { lat: 6.6018, lng: 3.3517 }      // ~2.6 km away

  it('verifies a fix within the 150 m default threshold', () => {
    expect(verifyFacilityMatch(onSite, facility)).toBe(true)
  })
  it('does not verify a fix beyond the 150 m default threshold', () => {
    expect(verifyFacilityMatch(far, facility)).toBe(false)
  })
  it('honours a custom threshold', () => {
    expect(verifyFacilityMatch(far, facility, 5000)).toBe(true)
    expect(verifyFacilityMatch(far, facility, 100)).toBe(false)
  })
  it('never verifies with unusable coordinates', () => {
    expect(verifyFacilityMatch(onSite, null)).toBe(false)
    expect(verifyFacilityMatch(null, facility)).toBe(false)
    expect(verifyFacilityMatch(onSite, { lat: NaN, lng: 3 })).toBe(false)
  })
  it('exposes the 150 m default constant', () => {
    expect(FACILITY_VERIFY_THRESHOLD_M).toBe(150)
  })
})

describe('parseOverpass', () => {
  const sample = {
    elements: [
      { type: 'node', lat: 6.5831, lon: 3.3331, tags: { amenity: 'hospital', name: 'LUTH', 'addr:street': 'Idi-Araba' } },
      { type: 'way', center: { lat: 6.5800, lon: 3.3300 }, tags: { amenity: 'pharmacy', name: 'MediPharm' } },
      { type: 'node', lat: 6.59, lon: 3.34, tags: { amenity: 'clinic' } },     // no name -> fallback
      { type: 'node', lat: 6.60, lon: 3.35 },                                   // no coords-usable tags but has coords
      { type: 'node', tags: { amenity: 'hospital', name: 'NoCoords' } },        // missing coords -> dropped
    ],
  }

  it('parses rows with name, category, coords and address', () => {
    const rows = parseOverpass(sample)
    expect(rows.length).toBe(4) // the 5th (NoCoords) is dropped
    const hosp = rows.find(function (r) { return r.name === 'LUTH' })
    expect(hosp.category).toBe(FACILITY_CATEGORY.HOSPITAL)
    expect(hosp.lat).toBeCloseTo(6.5831)
    expect(hosp.lng).toBeCloseTo(3.3331)
    expect(hosp.address).toContain('Idi-Araba')
  })
  it('reads way coordinates from the center block', () => {
    const rows = parseOverpass(sample)
    const pharm = rows.find(function (r) { return r.name === 'MediPharm' })
    expect(pharm.category).toBe(FACILITY_CATEGORY.PHARMACY)
    expect(pharm.lat).toBeCloseTo(6.58)
    expect(pharm.lng).toBeCloseTo(3.33)
  })
  it('falls back to a readable label when a name is absent', () => {
    const rows = parseOverpass(sample)
    const clinic = rows.find(function (r) { return r.category === FACILITY_CATEGORY.CLINIC })
    expect(clinic.name).toBe('Clinic')
    const bare = rows.find(function (r) { return r.lat === 6.6 })
    expect(bare.name).toBe('Unnamed facility')
  })
  it('returns an empty array for malformed input', () => {
    expect(parseOverpass(null)).toEqual([])
    expect(parseOverpass({})).toEqual([])
    expect(parseOverpass({ elements: 'nope' })).toEqual([])
  })
})

describe('rankFacilities', () => {
  const gps = { lat: 6.58, lng: 3.33 }
  const facilities = [
    { name: 'Far', lat: 6.70, lng: 3.50, category: 'Hospital' },
    { name: 'Near', lat: 6.581, lng: 3.331, category: 'Pharmacy' },
    { name: 'Mid', lat: 6.60, lng: 3.40, category: 'Clinic/Diagnostic' },
  ]

  it('sorts nearest-first and attaches rounded distanceM', () => {
    const ranked = rankFacilities(facilities, gps)
    expect(ranked.map(function (r) { return r.name })).toEqual(['Near', 'Mid', 'Far'])
    expect(ranked[0].distanceM).toBeLessThan(ranked[1].distanceM)
    expect(ranked[1].distanceM).toBeLessThan(ranked[2].distanceM)
    expect(Number.isInteger(ranked[0].distanceM)).toBe(true)
  })
  it('caps the result at the requested ceiling', () => {
    const many = Array.from({ length: 200 }, function (_, i) {
      return { name: 'F' + i, lat: 6.58 + i * 0.0001, lng: 3.33, category: 'Hospital' }
    })
    expect(rankFacilities(many, gps, { cap: 150 }).length).toBe(150)
    expect(rankFacilities(many, gps).length).toBe(150)
  })
})

describe('matchesCategory', () => {
  const hosp = { category: FACILITY_CATEGORY.HOSPITAL }
  const pharm = { category: FACILITY_CATEGORY.PHARMACY }
  const clinic = { category: FACILITY_CATEGORY.CLINIC }
  const other = { category: FACILITY_CATEGORY.OTHER }

  it('passes everything through for "all"', () => {
    expect(matchesCategory(hosp, 'all')).toBe(true)
    expect(matchesCategory(hosp, null)).toBe(true)
  })
  it('matches the exact category per filter key', () => {
    expect(matchesCategory(hosp, 'hospital')).toBe(true)
    expect(matchesCategory(pharm, 'pharmacy')).toBe(true)
    expect(matchesCategory(clinic, 'clinic')).toBe(true)
    expect(matchesCategory(other, 'other')).toBe(true)
  })
  it('rejects facilities outside the chosen bucket', () => {
    expect(matchesCategory(pharm, 'hospital')).toBe(false)
    expect(matchesCategory(clinic, 'pharmacy')).toBe(false)
    expect(matchesCategory(other, 'clinic')).toBe(false)
  })
  it('buckets expanded categories for Manufacturer/Importer facility filtering', () => {
    // Clinic bucket includes lab, medical centre, specialist
    expect(matchesCategory({ category: FACILITY_CATEGORY.LABORATORY }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.MEDICAL_CENTRE }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.SPECIALIST_CLINIC }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.CLINIC_DIAGNOSTIC_LEGACY }, 'clinic')).toBe(true)
    // Other bucket includes dental, eye, physio, primary, aesthetic, spa
    expect(matchesCategory({ category: FACILITY_CATEGORY.DENTAL }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.EYE }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.PHYSIO }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.PRIMARY }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.AESTHETIC_CLINIC }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.COSMETICS_SPA }, 'other')).toBe(true)
    // Hospital/pharmacy are exclusive
    expect(matchesCategory({ category: FACILITY_CATEGORY.DENTAL }, 'hospital')).toBe(false)
    expect(matchesCategory({ category: FACILITY_CATEGORY.LABORATORY }, 'hospital')).toBe(false)
  })
  it('legacy clinic/other values still map to correct buckets', () => {
    expect(matchesCategory({ category: 'Clinic/Diagnostic' }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: 'Other health facility' }, 'other')).toBe(true)
  })
})

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
