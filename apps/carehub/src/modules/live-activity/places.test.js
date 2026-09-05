import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  buildOverpassQuery, fetchOverpass, MAX_FACILITIES, FACILITY_FILTERS,
  getRepAddedFacilities, confirmRepAddedFacility, dismissRepAddedFacility, addRepAddedFacility,
  nearbyHealthFacilities,
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
    expect(categoryFromAmenity('dentist')).toBe(FACILITY_CATEGORY.DENTAL)
  })
  it('maps expanded facility categories for Manufacturer/Importer visits', () => {
    expect(categoryFromAmenity('laboratory')).toBe(FACILITY_CATEGORY.LABORATORY)
    expect(categoryFromAmenity('optician')).toBe(FACILITY_CATEGORY.EYE)
    expect(categoryFromAmenity('physiotherapist')).toBe(FACILITY_CATEGORY.PHYSIO)
    expect(categoryFromAmenity('beauty')).toBe(FACILITY_CATEGORY.COSMETICS)
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

describe('nearbyHealthFacilities cache reads', () => {
  beforeEach(function () { sbFetch.mockResolvedValue([]) })
  afterEach(function () { vi.clearAllMocks() })

  // Five cached rows is CACHE_MIN_RESULTS, so Overpass is never consulted and
  // the test stays offline.
  const repRow = function (i) {
    return { id: 'r' + i, name: 'Rep Clinic ' + i, lat: 6.5, lng: 3.3, category: 'Clinic/Diagnostic', status: 'pending_review' }
  }

  it('reads rep-added facilities with the columns the table actually has', async () => {
    sbFetch
      .mockResolvedValueOnce([])                                      // facilities_cache
      .mockResolvedValueOnce([1, 2, 3, 4, 5].map(repRow))             // rep_added_facilities
    const res = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'biz' })

    const repUrl = String(sbFetch.mock.calls[1][0])
    expect(repUrl).toContain('rep_added_facilities?business_id=eq.biz')
    expect(repUrl).toContain('select=id,name,lat,lng,category,status')
    // Regression (issue #1): `address` does not exist on this table. Requesting
    // it made PostgREST reject the read, and the catch turned that into an empty
    // list — rep-added places silently never reached anyone's nearby list.
    expect(repUrl).not.toContain('address')

    expect(res.facilities).toHaveLength(5)
    expect(res.facilities[0].name).toBe('Rep Clinic 1')
    expect(res.facilities[0].source).toBe('rep_added')
    expect(res.facilities[0].address).toBe('')
  })

  it('surfaces both confirmed and pending rep-added facilities', async () => {
    sbFetch.mockResolvedValueOnce([]).mockResolvedValueOnce([1, 2, 3, 4, 5].map(repRow))
    await nearbyHealthFacilities(6.5, 3.3, { businessId: 'biz' })
    expect(String(sbFetch.mock.calls[1][0])).toContain('status=in.(confirmed,pending_review)')
  })

  // Issue #1 audit item 4: pendingReview is what stops a place the rep typed
  // themselves from being counted as GPS verification.
  it('marks unconfirmed rep-added facilities as pending review, confirmed ones not', async () => {
    sbFetch.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'p', name: 'Pending Place', lat: 6.5, lng: 3.3, category: 'Clinic/Diagnostic', status: 'pending_review' },
      { id: 'c', name: 'Confirmed Place', lat: 6.5, lng: 3.3, category: 'Clinic/Diagnostic', status: 'confirmed' },
      repRow(3), repRow(4), repRow(5),
    ])
    const res = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'biz' })
    const byName = Object.fromEntries(res.facilities.map(function (f) { return [f.name, f] }))
    expect(byName['Pending Place'].pendingReview).toBe(true)
    expect(byName['Confirmed Place'].pendingReview).toBe(false)
  })

  it('never marks a cached facility as pending — the cache holds reviewed rows only', async () => {
    sbFetch.mockResolvedValueOnce([
      { id: 'c1', name: 'Detected', lat: 6.5, lng: 3.3, category: 'Hospital', address: 'Rd', source: 'detected' },
      { id: 'c2', name: 'Promoted', lat: 6.5, lng: 3.3, category: 'Hospital', address: null, source: 'rep_added' },
      { id: 'c3', name: 'C3', lat: 6.5, lng: 3.3, source: 'detected' },
      { id: 'c4', name: 'C4', lat: 6.5, lng: 3.3, source: 'detected' },
      { id: 'c5', name: 'C5', lat: 6.5, lng: 3.3, source: 'detected' },
    ]).mockResolvedValueOnce([])
    const res = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'biz' })
    expect(res.facilities.every(function (f) { return f.pendingReview === false })).toBe(true)
    expect(res.fromCache).toBe(true)
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
    // Shape mirrors the real table: rep_added_facilities has no `address`.
    sbFetch.mockResolvedValueOnce([{ name: 'F', lat: 1, lng: 2, category: 'Hospital' }])
    await confirmRepAddedFacility('fid', 'biz')
    // Regression (issue #1): selecting a column the table does not have made
    // PostgREST reject this read, so Confirm could never succeed.
    const read = String(sbFetch.mock.calls[0][0])
    expect(read).toContain('select=name,lat,lng,category')
    expect(read).not.toContain('address')
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
    // Roles as real Manufacturer/Importer tenants actually store them — typed
    // per business, never the bare preset "Manager" (issue #1).
    sbFetch
      .mockResolvedValueOnce([{ id: 'new', name: 'NewClinic' }]) // insert
      .mockResolvedValueOnce([                                    // staff roster
        { id: 'mgr1', role: 'Regional Manager' },
        { id: 'mgr2', role: 'Four sisters Manager' },
        { id: 'rep1', role: 'Medical sales rep' },
        { id: 'noRole', role: null },
      ])
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
    expect(ids).toContain('mgr2')
    expect(ids).not.toContain('rep1')
    expect(ids).not.toContain('noRole')
    expect(ids).toContain(null) // the owner, who has no staff row
  })

  it('asks for the roster without a role filter, so custom manager titles match', async () => {
    sbFetch.mockResolvedValueOnce([{ id: 'new' }]).mockResolvedValueOnce([])
    await addRepAddedFacility('biz', { name: 'X', lat: 1, lng: 2 }, 'rep1')
    await vi.waitFor(function () { expect(notify).toHaveBeenCalledTimes(1) })
    const staffUrl = String(sbFetch.mock.calls[1][0])
    expect(staffUrl).toContain('staff?business_id=eq.biz')
    expect(staffUrl).toContain('select=id,role')
    // Regression (issue #1): `role=in.(Manager,Owner)` matched no real row.
    expect(staffUrl).not.toContain('role=in.')
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

describe('Manufacturer/Importer GPS facility filtering (fix verification)', () => {
  beforeEach(function () { sbFetch.mockResolvedValue([]) })
  afterEach(function () { vi.clearAllMocks() })

  it('buildOverpassQuery now includes healthcare and shop tags so all facility types are discoverable', () => {
    const q = buildOverpassQuery(6.5, 3.3, 200)
    expect(q).toContain('"healthcare"~"')
    expect(q).toContain('"shop"~"')
    // Still contains original amenity check
    expect(q).toContain('"amenity"~"hospital|pharmacy|clinic')
  })

  it('matchesCategory buckets cover all required healthcare facility categories', () => {
    // Clinic bucket holds lab, medical centre, specialist etc
    expect(matchesCategory({ category: FACILITY_CATEGORY.LABORATORY }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.MEDICAL_CENTRE }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.SPECIALIST_CLINIC }, 'clinic')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.CLINIC }, 'clinic')).toBe(true)
    // Other bucket holds dental, eye, physio, primary, aesthetic, spa
    expect(matchesCategory({ category: FACILITY_CATEGORY.DENTAL }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.EYE }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.PHYSIO }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.PRIMARY }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.AESTHETIC_CLINIC }, 'other')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.COSMETICS_SPA }, 'other')).toBe(true)
    // Hospital/pharmacy are exclusive to their buckets
    expect(matchesCategory({ category: FACILITY_CATEGORY.HOSPITAL }, 'pharmacy')).toBe(false)
    expect(matchesCategory({ category: FACILITY_CATEGORY.PHARMACY }, 'hospital')).toBe(false)
    // All shows everything regardless of business_type
    expect(matchesCategory({ category: FACILITY_CATEGORY.DENTAL }, 'all')).toBe(true)
    expect(matchesCategory({ category: FACILITY_CATEGORY.LABORATORY }, 'all')).toBe(true)
  })

  it('nearbyHealthFacilities with category all returns mixed facility categories for Manufacturer/Importer', async () => {
    const mixedCache = [
      { id: 'h1', name: 'General Hospital', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, address: 'A', source: 'detected' },
      { id: 'p1', name: 'HealthPlus Pharmacy', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.PHARMACY, address: 'B', source: 'detected' },
      { id: 'l1', name: 'Clinix Lab', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.LABORATORY, address: 'C', source: 'detected' },
      { id: 'c1', name: 'City Clinic', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.CLINIC, address: 'D', source: 'detected' },
      { id: 'd1', name: 'Smile Dental', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.DENTAL, address: 'E', source: 'detected' },
      { id: 'e1', name: 'Eye Care', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.EYE, address: 'F', source: 'detected' },
    ]
    sbFetch.mockResolvedValueOnce(mixedCache).mockResolvedValueOnce([])
    const resAll = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'manufacturer_biz', category: 'all' })
    expect(resAll.facilities.length).toBe(6)
    const cats = resAll.facilities.map(function (f) { return f.category })
    expect(cats).toContain(FACILITY_CATEGORY.HOSPITAL)
    expect(cats).toContain(FACILITY_CATEGORY.PHARMACY)
    expect(cats).toContain(FACILITY_CATEGORY.LABORATORY)
    expect(cats).toContain(FACILITY_CATEGORY.DENTAL)
  })

  it('pharmacy filter returns only pharmacies for Manufacturer/Importer near a pharmacy', async () => {
    const mixedCache = [
      { id: 'h1', name: 'General Hospital', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, address: 'A', source: 'detected' },
      { id: 'p1', name: 'HealthPlus Pharmacy', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.PHARMACY, address: 'B', source: 'detected' },
      { id: 'p2', name: 'MediPharm', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.PHARMACY, address: 'C', source: 'detected' },
      { id: 'c1', name: 'City Clinic', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.CLINIC, address: 'D', source: 'detected' },
      { id: 'l1', name: 'Lab Centre', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.LABORATORY, address: 'E', source: 'detected' },
    ]
    sbFetch.mockResolvedValueOnce(mixedCache).mockResolvedValueOnce([])
    const res = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'manufacturer_biz', category: 'pharmacy' })
    expect(res.facilities.length).toBe(2)
    expect(res.facilities.every(function (f) { return f.category === FACILITY_CATEGORY.PHARMACY })).toBe(true)
  })

  it('clinic-diagnostic filter returns labs, clinics, medical centres and specialist clinics', async () => {
    const mixedCache = [
      { id: 'l1', name: 'Clinix Lab', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.LABORATORY, address: 'A', source: 'detected' },
      { id: 'c1', name: 'City Clinic', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.CLINIC, address: 'B', source: 'detected' },
      { id: 'm1', name: 'Medi Centre', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.MEDICAL_CENTRE, address: 'C', source: 'detected' },
      { id: 's1', name: 'Cardio Specialist', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.SPECIALIST_CLINIC, address: 'D', source: 'detected' },
      { id: 'h1', name: 'General Hospital', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, address: 'E', source: 'detected' },
    ]
    sbFetch.mockResolvedValueOnce(mixedCache).mockResolvedValueOnce([])
    const res = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'manufacturer_biz', category: 'clinic' })
    expect(res.facilities.length).toBe(4)
    expect(res.facilities.every(function (f) {
      return [FACILITY_CATEGORY.LABORATORY, FACILITY_CATEGORY.CLINIC, FACILITY_CATEGORY.MEDICAL_CENTRE, FACILITY_CATEGORY.SPECIALIST_CLINIC].includes(f.category)
    })).toBe(true)
  })

  it('other filter returns dental, eye, physio, aesthetic, spa, primary and other facilities', async () => {
    const mixedCache = [
      { id: 'd1', name: 'Smile Dental', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.DENTAL, address: 'A', source: 'detected' },
      { id: 'e1', name: 'Eye Care', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.EYE, address: 'B', source: 'detected' },
      { id: 'ph1', name: 'Rehab Physio', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.PHYSIO, address: 'C', source: 'detected' },
      { id: 'a1', name: 'Glow Aesthetic', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.AESTHETIC_CLINIC, address: 'D', source: 'detected' },
      { id: 'h1', name: 'General Hospital', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, address: 'E', source: 'detected' },
    ]
    sbFetch.mockResolvedValueOnce(mixedCache).mockResolvedValueOnce([])
    const res = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'manufacturer_biz', category: 'other' })
    expect(res.facilities.length).toBe(4)
    expect(res.facilities.every(function (f) { return f.category !== FACILITY_CATEGORY.HOSPITAL })).toBe(true)
  })

  it('does not restrict by business_type — same GPS returns same facilities for different business_types', async () => {
    const cache = [
      { id: 'h1', name: 'General Hospital', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.HOSPITAL, address: 'A', source: 'detected' },
      { id: 'p1', name: 'Pharmacy One', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.PHARMACY, address: 'B', source: 'detected' },
      { id: 'l1', name: 'Lab One', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.LABORATORY, address: 'C', source: 'detected' },
      { id: 'c1', name: 'Clinic One', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.CLINIC, address: 'D', source: 'detected' },
      { id: 'd1', name: 'Dental One', lat: 6.5, lng: 3.3, category: FACILITY_CATEGORY.DENTAL, address: 'E', source: 'detected' },
    ]
    sbFetch.mockResolvedValueOnce(cache).mockResolvedValueOnce([])
    const manu = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'biz_manufacturer', category: 'all' })
    // Reset mocks for second call — simulate different business_type but same facilities cached per business
    sbFetch.mockResolvedValueOnce(cache).mockResolvedValueOnce([])
    const retail = await nearbyHealthFacilities(6.5, 3.3, { businessId: 'biz_retail', category: 'all' })
    expect(manu.facilities.length).toBe(retail.facilities.length)
    expect(manu.facilities.map(function (f) { return f.category }).sort()).toEqual(retail.facilities.map(function (f) { return f.category }).sort())
  })
})
