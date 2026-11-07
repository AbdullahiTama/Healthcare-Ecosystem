import { describe, it, expect } from 'vitest'
import { discoverFacilitiesPath } from '../places.js'

// Found in the live end-to-end check (2026-11-06): blank filters sent as '' made the database drop every business
// with no LGA or city recorded, so a Lagos search returned nothing although 13 businesses matched.
describe('discoverFacilitiesPath', () => {
  it('leaves blank filters out so the database treats them as "no filter"', () => {
    expect(discoverFacilitiesPath({ state: 'Lagos', lga: '', city: '  ', keyword: undefined, limit: 100, offset: 0 }))
      .toBe('rpc/discover_facilities_cursor?p_state=Lagos&p_category=all&p_limit=100&p_cursor=0')
  })
  it('sends every filter that was filled in, encoded', () => {
    expect(discoverFacilitiesPath({ state: 'FCT', lga: 'Abuja Municipal', city: 'Wuse', category: 'hospital', keyword: 'St & Co', limit: 20, offset: 40 }))
      .toBe('rpc/discover_facilities_cursor?p_state=FCT&p_lga=Abuja%20Municipal&p_city=Wuse&p_category=hospital&p_keyword=St%20%26%20Co&p_limit=20&p_cursor=40')
  })
})
