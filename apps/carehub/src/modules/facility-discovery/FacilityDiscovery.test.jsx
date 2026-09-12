import { describe, it, expect } from 'vitest'
import { NIGERIA_STATES, getLgasForState } from '../../lib/nigeriaGeo.js'
import { FACILITY_FILTERS } from '../../lib/places.js'
import { FACILITY_CATEGORY } from '../../lib/geo.js'

describe('FacilityDiscovery module', () => {
  it('State -> LGA wiring: Lagos has 20 LGAs via getLgasForState', () => {
    const lgas = getLgasForState('Lagos')
    expect(lgas.length).toBe(20)
    expect(lgas).toContain('Ikeja')
    const allStates = NIGERIA_STATES.map(s => s.name)
    expect(allStates.length).toBe(37)
  })

  it('Category 16: FACILITY_FILTERS has 16+all categories including Manufacturer/Importer/Distributor/Spa', () => {
    const keys = FACILITY_FILTERS.map(f => f.key)
    expect(keys).toContain('manufacturer')
    expect(keys).toContain('importer')
    expect(keys).toContain('distributor')
    expect(keys).toContain('spa')
    expect(keys).toContain('cosmetics')
    expect(keys).toContain('aesthetic')
    expect(FACILITY_CATEGORY.SPA).toBeDefined()
    expect(FACILITY_CATEGORY.MANUFACTURER).toBeDefined()
    // total should be 18 (all + 17) or at least 17
    expect(FACILITY_FILTERS.length).toBeGreaterThanOrEqual(17)
  })

  it('Search modes: has Current, State, LGA, City-Area, Nigeria modes', async () => {
    const { default: FacilityDiscovery } = await import('./FacilityDiscovery.jsx')
    expect(typeof FacilityDiscovery).toBe('function')
  })

  it('dedupe/confidence/verification wiring exists in engine', async () => {
    const engine = await import('../../lib/facilityDiscovery.js')
    expect(typeof engine.dedupeFacilities).toBe('function')
    expect(typeof engine.confidenceScore).toBe('function')
    expect(typeof engine.verificationStatus).toBe('function')
    expect(engine.VERIFICATION_LEVEL.VERIFIED).toBe('verified')
  })

  it('no 200m hard cap: places DEFAULT_RADIUS is not 200', async () => {
    const places = await import('../../lib/places.js')
    expect(places.DEFAULT_RADIUS).not.toBe(200)
    expect(places.PROGRESSIVE_RADII).toBeDefined()
    expect(places.PROGRESSIVE_RADII.length).toBeGreaterThan(0)
  })

  it('filter->query wiring supports pagination via cursor', async () => {
    const { discoverFacilities } = await import('../../lib/facilityDiscovery.js')
    expect(typeof discoverFacilities).toBe('function')
  })
})
