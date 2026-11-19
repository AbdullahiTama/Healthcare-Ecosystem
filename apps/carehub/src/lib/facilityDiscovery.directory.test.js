import { describe, it, expect, vi, beforeEach } from 'vitest'

// Facility Discovery reads the platform Business Directory (bulk imports included) through
// discover_directory_listings (carehub_20270126). These tests drive the public entry point,
// discoverFacilities, with the transport mocked, and check what a company user would see.

const calls = []
let directoryRows = []
let directoryFails = false

vi.mock('../services/supabase.js', () => ({
  sbFetch: vi.fn(async (path, opts) => {
    const p = String(path)
    calls.push({ path: p, body: opts && opts.body ? JSON.parse(opts.body) : null })
    if (p.startsWith('rpc/discover_directory_listings')) {
      if (directoryFails) throw new Error('Not authorized')
      return { rows: directoryRows, total: directoryRows.length, hasMore: false }
    }
    if (p.startsWith('rpc/discover_facilities_cursor')) return { rows: [] }
    return []
  }),
  notify: vi.fn(),
}))

// Imported listings as the database returns them (shape of discover_directory_listings rows).
const listing = (over) => ({
  id: 'u1', name: 'Medplus Ikeja', business_type: 'Pharmacy', category: 'Pharmacy', subcategory: 'Community / Retail Pharmacy',
  address: '12 Allen Avenue', state: 'Lagos', lga: 'Ikeja', city: 'Ikeja', latitude: 6.6, longitude: 3.35,
  phone: '08030000000', verification_status: 'unverified', data_source: 'import', distance_km: null, ...over,
})

const { discoverFacilities, fetchSources, FACILITY_SOURCE, VERIFICATION_LEVEL } = await import('./facilityDiscovery.js')
const { FACILITY_CATEGORY } = await import('./geo.js')
const directoryCall = () => calls.find((c) => c.path.startsWith('rpc/discover_directory_listings'))

beforeEach(() => {
  calls.length = 0
  directoryFails = false
  directoryRows = [
    listing({}),
    listing({ id: 'u2', name: 'Reddington Hospital', business_type: 'Hospital', category: 'Hospital', latitude: 6.61, longitude: 3.36 }),
    listing({ id: 'u3', name: 'Verified Chemist', verification_status: 'verified', latitude: 6.62, longitude: 3.37 }),
    listing({ id: 'u4', name: 'Emzor Manufacturing', business_type: 'Manufacturer / Importer', category: null, latitude: 6.63, longitude: 3.38 }),
  ]
  // Location resolution and map providers are external: answer nothing, so only internal sources count.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [], text: async () => '[]', headers: { get: () => null } })))
})

describe('Facility Discovery shows CareHub directory listings', () => {
  it('lists imported listings nationwide, labelled with their source and recorded verification', async () => {
    const res = await discoverFacilities({ mode: 'nigeria', pageSize: 50 })
    const byName = Object.fromEntries(res.facilities.map((f) => [f.name, f]))
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(['Medplus Ikeja', 'Reddington Hospital', 'Verified Chemist', 'Emzor Manufacturing']))
    expect(byName['Medplus Ikeja']).toMatchObject({ source: FACILITY_SOURCE.DIRECTORY, category: FACILITY_CATEGORY.PHARMACY, phone: '08030000000', state: 'Lagos', lga: 'Ikeja', lat: 6.6, lng: 3.35 })
    expect(byName['Medplus Ikeja'].verification).toBe(VERIFICATION_LEVEL.UNVERIFIED)
    expect(byName['Verified Chemist'].verification).toBe(VERIFICATION_LEVEL.VERIFIED)
    expect(byName['Emzor Manufacturing'].category).toBe(FACILITY_CATEGORY.MANUFACTURER)
    expect(res.unavailableSources).toEqual([])
    expect(directoryCall().body).toMatchObject({ p_state: null, p_lga: null, p_city: null, p_lat: null, p_lng: null })
  })

  it('filters by category on the client, like every other source', async () => {
    const hospitals = await discoverFacilities({ mode: 'nigeria', category: 'hospital', pageSize: 50 })
    expect(hospitals.facilities.map((f) => f.name)).toEqual(['Reddington Hospital'])
    const makers = await discoverFacilities({ mode: 'nigeria', category: 'manufacturer', pageSize: 50 })
    expect(makers.facilities.map((f) => f.name)).toEqual(['Emzor Manufacturing'])
  })

  it('filters by the directory source and by verification', async () => {
    const onlyDir = await discoverFacilities({ mode: 'nigeria', source: 'directory', pageSize: 50 })
    expect(onlyDir.total).toBe(4)
    const verified = await discoverFacilities({ mode: 'nigeria', source: 'directory', verification: 'verified', pageSize: 50 })
    expect(verified.facilities.map((f) => f.name)).toEqual(['Verified Chemist'])
  })

  it('sends name searches and state / LGA / city to the database', async () => {
    await discoverFacilities({ mode: 'lga', state: 'Lagos', lga: 'Ikeja', keyword: 'medplus', pageSize: 50 })
    expect(directoryCall().body).toMatchObject({ p_state: 'Lagos', p_lga: 'Ikeja', p_keyword: 'medplus', p_lat: null, p_lng: null })
  })

  it('searches around a point with the chosen distance when no place is named', async () => {
    const rows = await fetchSources({ centre: { lat: 6.6, lng: 3.35 }, mode: 'current', radiusKm: 2 })
    expect(directoryCall().body).toMatchObject({ p_state: null, p_lat: 6.6, p_lng: 3.35, p_radius_km: 2 })
    expect(rows.filter((r) => r.source === FACILITY_SOURCE.DIRECTORY)).toHaveLength(4)
  })

  it('reports an unavailable directory instead of silently showing fewer results', async () => {
    directoryFails = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await discoverFacilities({ mode: 'nigeria', pageSize: 50 })
    expect(res.unavailableSources).toEqual([FACILITY_SOURCE.DIRECTORY])
    expect(res.facilities.some((f) => f.source === FACILITY_SOURCE.DIRECTORY)).toBe(false)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('keeps a directory listing primary when OpenStreetMap has the same place', async () => {
    const { dedupeFacilities } = await import('./facilityDiscovery.js')
    const dir = { name: 'Medplus Ikeja', lat: 6.6, lng: 3.35, source: FACILITY_SOURCE.DIRECTORY, id: 'directory:u1', recordedVerification: 'unverified' }
    const osm = { name: 'Medplus Ikeja', lat: 6.60001, lng: 3.35001, source: 'osm', id: 'o1' }
    const [merged] = dedupeFacilities([dir, osm])
    expect(merged.source).toBe(FACILITY_SOURCE.DIRECTORY)
    expect(merged.recordedVerification).toBe('unverified')
  })
})
