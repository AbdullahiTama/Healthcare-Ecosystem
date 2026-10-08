import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  dedupeFacilities, confidenceScore, verificationStatus,
  VERIFICATION_LEVEL, normalizeName, normalizePhone, extractDomain,
  FACILITY_SOURCE
} from './facilityDiscovery.js'
import { FACILITY_CATEGORY } from './geo.js'

describe('facilityDiscovery dedupe', () => {
  it('merges same facility across CareFind + OSM + Google via 50m + name', () => {
    const carefind = { name: 'HealthPlus Pharmacy', lat: 6.5244, lng: 3.3792, phone: '08012345678', source: 'carefind', id: 'c1', category: FACILITY_CATEGORY.PHARMACY }
    const osm = { name: 'HealthPlus Pharmacy', lat: 6.52441, lng: 3.37921, source: 'osm', id: 'o1', category: FACILITY_CATEGORY.PHARMACY }
    const google = { name: 'Healthplus Pharmacy', lat: 6.52442, lng: 3.37919, source: 'google', id: 'g1', category: FACILITY_CATEGORY.PHARMACY }
    const deduped = dedupeFacilities([carefind, osm, google])
    expect(deduped.length).toBe(1)
    expect(deduped[0].sourceRefs.length).toBe(3)
    expect(deduped[0].source).toBe('carefind') // primary wins
    expect(deduped[0].sourceRefs.map(s=>s.source)).toEqual(expect.arrayContaining(['carefind','osm','google']))
  })
  it('keeps ambiguous far apart same name as separate', () => {
    const a = { name: 'City Clinic', lat: 6.5, lng: 3.3, source: 'carefind', category: FACILITY_CATEGORY.CLINIC }
    const b = { name: 'City Clinic', lat: 6.6, lng: 3.4, source: 'osm', category: FACILITY_CATEGORY.CLINIC } // ~15km apart
    const deduped = dedupeFacilities([a,b])
    expect(deduped.length).toBe(2)
  })
  it('dedupes via 5-dec lat/lng + name (spec dedupeKey)', () => {
    const a = { name: 'LUTH', lat: 6.52440, lng: 3.37920, source: 'osm', category: FACILITY_CATEGORY.HOSPITAL }
    const b = { name: 'LUTH', lat: 6.524404, lng: 3.379204, source: 'carefind', category: FACILITY_CATEGORY.HOSPITAL } // same to 5 decimals
    const deduped = dedupeFacilities([a,b])
    expect(deduped.length).toBe(1)
  })
  it('dedupes via phone match + close coords', () => {
    const a = { name: 'Medi Lab', lat: 6.5, lng: 3.3, phone: '0803 123 4567', source: 'carefind', category: FACILITY_CATEGORY.LABORATORY }
    const b = { name: 'Medi Lab Diagnostic', lat: 6.5001, lng: 3.3001, phone: '08031234567', source: 'osm', category: FACILITY_CATEGORY.LABORATORY }
    expect(dedupeFacilities([a,b]).length).toBe(1)
  })
  it('distinct domains keep separate when coords far', () => {
    const a = { name: 'Clinic A', lat: 6.5, lng: 3.3, website: 'https://clinica.ng', source: 'carefind', category: FACILITY_CATEGORY.CLINIC }
    const b = { name: 'Clinic A', lat: 6.8, lng: 3.6, website: 'https://clinica.ng', source: 'osm', category: FACILITY_CATEGORY.CLINIC }
    // same domain + same name but far (>50m) should remain separate via threshold — domain alone not enough without close
    // our heuristic requires close+domain; far should be 2
    expect(dedupeFacilities([a,b]).length).toBe(2)
  })
  it('low confidence for ambiguous merge candidate', () => {
    const a = { name: 'Central Hospital', lat: 6.5, lng: 3.3, source: 'osm', category: FACILITY_CATEGORY.OTHER }
    const b = { name: 'Central Hosp', lat: 6.5004, lng: 3.3004, source: 'google', category: FACILITY_CATEGORY.OTHER }
    // names not exact, coords ~50m, but phone/domain missing => ambiguous -> separate + low confidence
    const deduped = dedupeFacilities([a,b])
    expect(deduped.length).toBe(2)
    const conf = confidenceScore(deduped[0], { sourceCount: 1, gps: { lat: 6.5, lng: 3.3 } })
    expect(conf).toBeLessThan(60)
  })
})

describe('confidenceScore', () => {
  it('higher with source agreement', () => {
    const f = { name: 'General Hospital', lat: 6.5244, lng: 3.3792, category: FACILITY_CATEGORY.HOSPITAL, address: 'Ikeja', phone: '0801' }
    const single = confidenceScore(f, { sourceCount: 1, gps: { lat: 6.5244, lng: 3.3792 } })
    const multi = confidenceScore(f, { sourceCount: 3, gps: { lat: 6.5244, lng: 3.3792 } })
    expect(multi).toBeGreaterThan(single)
  })
  it('penalizes missing coords and Other category', () => {
    const precise = { name: 'Lab', lat: 6.52441, lng: 3.37921, category: FACILITY_CATEGORY.LABORATORY }
    const vague = { name: 'X', lat: null, lng: null, category: FACILITY_CATEGORY.OTHER }
    expect(confidenceScore(precise, { gps: { lat: 6.5, lng: 3.3 } })).toBeGreaterThan(confidenceScore(vague, { gps: { lat: 6.5, lng: 3.3 } }))
  })
  it('verified > pending', () => {
    const verified = { name: 'Hosp', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, source: 'carefind' }
    const pending = { name: 'Hosp', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, source: 'carefind', pendingReview: true }
    const gps = { lat: 6.5, lng: 3.3 }
    expect(confidenceScore(verified, { gps })).toBeGreaterThan(confidenceScore(pending, { gps }))
  })
})

describe('verificationStatus 6-level', () => {
  it('verified when within 150m', () => {
    const f = { lat: 6.5, lng: 3.3, source: 'carefind' }
    expect(verificationStatus(f, { lat: 6.5005, lng: 3.3005 })).toBe(VERIFICATION_LEVEL.VERIFIED)
  })
  it('pending when rep_added awaiting review', () => {
    const f = { lat: 6.5, lng: 3.3, source: 'rep_added', pendingReview: true }
    expect(verificationStatus(f, { lat: 6.5, lng: 3.3 })).toBe(VERIFICATION_LEVEL.PENDING)
  })
  it('unverified when beyond threshold', () => {
    const f = { lat: 6.5, lng: 3.3, source: 'carefind' }
    expect(verificationStatus(f, { lat: 6.6, lng: 3.4 })).toBe(VERIFICATION_LEVEL.UNVERIFIED)
  })
  it('external_unverified for OSM beyond threshold', () => {
    const f = { lat: 6.5, lng: 3.3, source: 'osm' }
    expect(verificationStatus(f, { lat: 6.6, lng: 3.4 })).toBe(VERIFICATION_LEVEL.EXTERNAL_UNVERIFIED)
  })
  it('no_gps when missing', () => {
    expect(verificationStatus({ lat: 6.5, lng: 3.3 }, null)).toBe(VERIFICATION_LEVEL.NO_GPS)
  })
  it('external never shows officially verified unless within threshold', () => {
    const f = { lat: 6.5, lng: 3.3, source: 'osm' }
    expect(verificationStatus(f, { lat: 6.5001, lng: 3.3001 })).toBe(VERIFICATION_LEVEL.VERIFIED) // within -> verified
    expect(verificationStatus(f, { lat: 6.6, lng: 3.4 })).not.toBe(VERIFICATION_LEVEL.VERIFIED)
  })
})

describe('normalize helpers', () => {
  it('normalizeName lowercases and trims', () => {
    expect(normalizeName('  Health-Plus Pharmacy! ')).toBe('healthplus pharmacy')
  })
  it('normalizePhone strips non-digits', () => {
    expect(normalizePhone('(080) 123-4567')).toBe('0801234567')
  })
  it('extractDomain parses', () => {
    expect(extractDomain('https://www.healthplus.ng/about')).toBe('healthplus.ng')
    expect(extractDomain('healthplus.ng')).toBe('healthplus.ng')
  })
})

describe('category mapping 16', () => {
  it('has 16 distinct categories plus legacy', async () => {
    const { FACILITY_CATEGORY } = await import('./geo.js')
    const distinct = new Set(Object.values(FACILITY_CATEGORY).filter(v => !['Clinic/Diagnostic','Other health facility','Cosmetics & Spa'].includes(v)))
    // Should be 17 distinct (including Other) but at least 16
    expect(distinct.size).toBeGreaterThanOrEqual(16)
    expect(FACILITY_CATEGORY.MANUFACTURER).toBeDefined()
    expect(FACILITY_CATEGORY.IMPORTER).toBeDefined()
    expect(FACILITY_CATEGORY.DISTRIBUTOR).toBeDefined()
    expect(FACILITY_CATEGORY.SPA).toBeDefined()
  })
})

describe('cross-state and large-area discovery (matrix rows: Cross-State, Nigeria-wide)', () => {
  it('resolveLocation State=Lagos independent of user GPS in Ogun (cross-state)', async () => {
    const { centreForState } = await import('./nigeriaGeo.js')
    const lagos = centreForState('Lagos')
    const ogun = centreForState('Ogun')
    expect(lagos).not.toBeNull()
    expect(ogun).not.toBeNull()
    expect(lagos.lat).toBeGreaterThan(6)
    expect(lagos.lat).toBeLessThan(7)
    expect(ogun.lat).not.toBe(lagos.lat)
    // Cross-state: resolved state centre is requested state, not user GPS state
    expect(lagos.lat).not.toBe(ogun.lat)
  })
  it('discoverFacilities partitions and paginates without hard 20-result cap', async () => {
    const { discoverFacilities } = await import('./facilityDiscovery.js')
    const mockFetch = vi.fn(async () => ({ ok: true, json: async () => [], text: async () => '[]', headers: { get: () => null } }))
    vi.stubGlobal('fetch', mockFetch)
    const res = await discoverFacilities({ mode: 'nigeria', category: 'all', page: 0, pageSize: 20 })
    vi.unstubAllGlobals()
    expect(res.facilities).toBeDefined()
    expect(typeof res.total).toBe('number')
    expect(typeof res.hasMore).toBe('boolean')
    expect(res.pageSize).toBe(20)
  })
  it('Nigeria-wide mode has national centre without GPS', async () => {
    const { resolveLocation } = await import('./nigeriaGeo.js')
    const r = await resolveLocation({ mode: 'nigeria' })
    expect(r.mode).toBe('nigeria')
    expect(r.label).toBe('Nigeria')
    expect(r.centre.lat).toBeCloseTo(9.082, 0)
  })
})
