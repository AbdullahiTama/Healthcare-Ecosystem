import { describe, it, expect } from 'vitest'
import { matchToDirectory, OSM_SOURCE_PREFIX } from '../matchListings.js'
import { deriveNormalized } from '../../services/normalize.js'

// Each OpenStreetMap business is new, already listed, or possibly listed, so the admin never adds one twice blindly.

const CATEGORIES = [{ id: 'ph', name: 'Pharmacy', is_active: true }, { id: 'ho', name: 'Hospital', is_active: true }]
const osm = (ref, name, lat, lng, tags = { amenity: 'pharmacy' }, extra = {}) => ({ ref, name, lat, lng, tags, address: '', phone: '', website: '', ...extra })
const listing = (id, name, lat, lng, extra = {}) => ({ id, name, latitude: lat, longitude: lng, category_id: 'ph', is_active: true, ...deriveNormalized({ name, ...extra }), ...extra })

describe('matchToDirectory', () => {
  it('a business added from the map before is already listed by its OpenStreetMap reference, even if renamed since', () => {
    const [r] = matchToDirectory([osm('node/1', 'Allen Pharmacy', 6.45, 3.39)], [listing('d1', 'Allen Pharma Ltd (renamed)', 7, 4, { source_detail: OSM_SOURCE_PREFIX + 'node/1' })], CATEGORIES)
    expect(r).toMatchObject({ status: 'listed', category: CATEGORIES[0] })
    expect(r.match.id).toBe('d1')
  })

  it('a listing with the same name a few metres away counts as already listed', () => {
    const [r] = matchToDirectory([osm('node/2', 'Mercy Pharmacy', 6.45, 3.39)], [listing('d2', 'Mercy Pharmacy', 6.4501, 3.3901)], CATEGORIES)
    expect(r.status).toBe('listed')
  })

  it('a similar name nearby is a possible duplicate', () => {
    const [r] = matchToDirectory([osm('node/3', 'Kemi Pharmacy Ikeja', 6.45, 3.39)], [listing('d3', 'Kemi Pharmacy', 6.4505, 3.3905)], CATEGORIES)
    expect(['duplicate', 'listed']).toContain(r.status)
    expect(r.match.id).toBe('d3')
  })

  it('anything else is new', () => {
    const [r] = matchToDirectory([osm('node/4', 'Brand New Chemist', 6.45, 3.39)], [listing('d4', 'Far Away Pharmacy', 9, 7)], CATEGORIES)
    expect(r).toMatchObject({ status: 'new', match: null })
  })

  it('businesses of a kind the platform does not manage are left out', () => {
    const rows = matchToDirectory([osm('node/5', 'Big Supermarket', 6.45, 3.39, { shop: 'supermarket' }), osm('node/6', 'City Hospital', 6.46, 3.4, { amenity: 'hospital' })], [], CATEGORIES)
    expect(rows.map((r) => r.ref)).toEqual(['node/6'])
    expect(rows[0].category.id).toBe('ho')
  })

  it('works with no listings at all', () => {
    expect(matchToDirectory([osm('node/7', 'A Pharmacy', 1, 2)], [], CATEGORIES)[0].status).toBe('new')
    expect(matchToDirectory([], null, CATEGORIES)).toEqual([])
  })
})
