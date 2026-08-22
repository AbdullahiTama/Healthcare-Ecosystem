import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  buildOverpassQuery, fetchOverpass, MAX_FACILITIES, FACILITY_FILTERS,
  getRepAddedFacilities, confirmRepAddedFacility, dismissRepAddedFacility, addRepAddedFacility,
} from '../../lib/places.js'
import {
  formatDistance, categoryFromAmenity, verifyFacilityMatch,
  parseOverpass, rankFacilities, matchesCategory,
  FACILITY_CATEGORY, FACILITY_VERIFY_THRESHOLD_M,
} from '../../lib/geo.js'
import { sbFetch, notify } from '../../services/supabase.js'

vi.mock('../../services/supabase.js', () => ({
  sbFetch: vi.fn(),
  notify: vi.fn(),
}))

describe('buildOverpassQuery', () => {
  it('builds a radius query around the GPS using health amenities', () => {
    const q = buildOverpassQuery(6.5, 3.3, 200)
    expect(q).toContain('around:200,6.5,3.3')
    expect(q).toContain('"amenity"~"hospital|pharmacy|clinic')
    expect(q).toContain('node[')
    expect(q).toContain('way[')
    expect(q).toContain('out center 150')
  })
})

describe('formatDistance (places-facing)', () => {
  it('formats the documented cases', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(120)).toBe('120 m')
    expect(formatDistance(1400)).toBe('1.4 km')
    expect(formatDistance(12300)).toBe('12.3 km')
  })
})

describe('categoryFromAmenity (places-facing)', () => {
  it('collapses OSM amenities onto app categories', () => {
    expect(categoryFromAmenity('hospital')).toBe(FACILITY_CATEGORY.HOSPITAL)
    expect(categoryFromAmenity('pharmacy')).toBe(FACILITY_CATEGORY.PHARMACY)
    expect(categoryFromAmenity('clinic')).toBe(FACILITY_CATEGORY.CLINIC)
    expect(categoryFromAmenity('dentist')).toBe(FACILITY_CATEGORY.OTHER)
  })
})

describe('verifyFacilityMatch (places-facing)', () => {
  const facility = { lat: 6.5833, lng: 3.3333 }
  const onSite = { lat: 6.5837, lng: 3.3339 }
  const far = { lat: 6.6018, lng: 3.3517 }
  it('verifies within 150 m and rejects beyond', () => {
    expect(verifyFacilityMatch(onSite, facility)).toBe(true)
    expect(verifyFacilityMatch(far, facility)).toBe(false)
    expect(FACILITY_VERIFY_THRESHOLD_M).toBe(150)
  })
})

describe('nearest-first sort and 150 cap (pure)', () => {
  const gps = { lat: 6.58, lng: 3.33 }
  it('orders by distance and caps at MAX_FACILITIES', () => {
    const many = Array.from({ length: 200 }, function (_, i) {
      return { name: 'F' + i, lat: 6.58 + i * 0.0001, lng: 3.33, category: 'Hospital' }
    })
    const ranked = rankFacilities(many, gps)
    expect(ranked.length).toBe(MAX_FACILITIES)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].distanceM).toBeGreaterThanOrEqual(ranked[i - 1].distanceM)
    }
  })
})

describe('matchesCategory against FACILITY_FILTERS', () => {
  it('the filter keys map to real categories', () => {
    const byKey = {}
    FACILITY_FILTERS.forEach(function (f) { byKey[f.key] = true })
    expect(byKey.all).toBe(true)
    expect(byKey.hospital).toBe(true)
    expect(byKey.pharmacy).toBe(true)
    expect(byKey.clinic).toBe(true)
    expect(byKey.other).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.HOSPITAL }, 'hospital')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.PHARMACY }, 'hospital')).toBe(false)
  })
})

describe('parseOverpass sample (pure parser)', () => {
  const sample = {
    elements: [
      { type: 'node', lat: 6.5831, lon: 3.3331, tags: { amenity: 'hospital', name: 'LUTH', 'addr:street': 'Idi-Araba' } },
      { type: 'way', center: { lat: 6.58, lon: 3.33 }, tags: { amenity: 'pharmacy', name: 'MediPharm' } },
      { type: 'node', lat: 6.6, lon: 3.35, tags: { amenity: 'clinic' } },
      { type: 'node', tags: { amenity: 'hospital', name: 'NoCoords' } },
    ],
  }
  it('parses rows including way centroids and drops coord-less rows', () => {
    const rows = parseOverpass(sample)
    expect(rows.length).toBe(3)
    expect(rows.find(function (r) { return r.name === 'LUTH' }).category).toBe(FACILITY_CATEGORY.HOSPITAL)
    const pharm = rows.find(function (r) { return r.name === 'MediPharm' })
    expect(pharm.lat).toBeCloseTo(6.58)
    expect(rows.find(function (r) { return r.category === FACILITY_CATEGORY.CLINIC }).name).toBe('Clinic')
  })
})

describe('rep-added facility review workflow (manager confirmation)', () => {
  beforeEach(function () { sbFetch.mockResolvedValue([]) })
  afterEach(function () { vi.clearAllMocks() })

  it('getRepAddedFacilities filters by status and orders desc', async () => {
    sbFetch.mockResolvedValueOnce([{ id: '1', name: 'F' }])
    const res = await getRepAddedFacilities('biz', 'pending_review')
    expect(sbFetch).toHaveBeenCalledWith(
      expect.stringContaining('rep_added_facilities?business_id=eq.biz&status=eq.pending_review&order=created_at.desc')
    )
    expect(res).toEqual([{ id: '1', name: 'F' }])
  })

  it('confirmRepAddedFacility flips status and promotes the facility into the cache', async () => {
    sbFetch.mockResolvedValueOnce([{ name: 'F', lat: 1, lng: 2, category: 'Hospital', address: 'Addr' }])
    await confirmRepAddedFacility('fid', 'biz')
    const patch = sbFetch.mock.calls.find(function (c) { return c[1] && c[1].method === 'PATCH' })
    expect(patch[0]).toContain('rep_added_facilities?id=eq.fid')
    expect(patch[1].body).toContain('confirmed')
    const cachePost = sbFetch.mock.calls.find(function (c) {
      return c[1] && c[1].method === 'POST' && String(c[0]).includes('facilities_cache')
    })
    expect(cachePost).toBeTruthy()
    expect(cachePost[1].body).toContain('F')
  })

  it('dismissRepAddedFacility deletes the row', async () => {
    await dismissRepAddedFacility('fid')
    const del = sbFetch.mock.calls.find(function (c) { return c[1] && c[1].method === 'DELETE' })
    expect(del[0]).toContain('rep_added_facilities?id=eq.fid')
  })

  it('addRepAddedFacility flags managers and the owner for review', async () => {
    sbFetch
      .mockResolvedValueOnce([{ id: 'new', name: 'NewClinic' }]) // insert
      .mockResolvedValueOnce([{ id: 'mgr1' }])                    // manager lookup
    await addRepAddedFacility('biz', { name: 'NewClinic', lat: 1, lng: 2, category: 'Clinic/Diagnostic' }, 'rep1')
    // the review flag is fired asynchronously (fire-and-forget), so wait for it
    await vi.waitFor(function () { expect(notify).toHaveBeenCalledTimes(1) })
    const biz = notify.mock.calls[0][0]
    const recipients = notify.mock.calls[0][1]
    const kind = notify.mock.calls[0][2]
    expect(biz).toBe('biz')
    expect(kind).toBe('facility_review')
    const ids = recipients.map(function (r) { return r.staffId })
    expect(ids).toContain('mgr1')
    expect(ids).toContain(null)
  })
})

describe('fetchOverpass (network, mocked)', () => {
  afterEach(function () { vi.restoreAllMocks() })
  it('posts the query and parses the JSON response', async () => {
    const fakeJson = { elements: [{ type: 'node', lat: 1, lon: 2, tags: { amenity: 'pharmacy', name: 'P' } }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fakeJson }))
    const rows = await fetchOverpass(6.5, 3.3, 200)
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('P')
    expect(rows[0].category).toBe(FACILITY_CATEGORY.PHARMACY)
    const fetchFn = global.fetch
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toContain('overpass-api.de')
    expect(opts.method).toBe('POST')
    expect(opts.body).toContain('data=')
  })
  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(fetchOverpass(6.5, 3.3)).rejects.toThrow(/Overpass lookup failed/)
  })
})
