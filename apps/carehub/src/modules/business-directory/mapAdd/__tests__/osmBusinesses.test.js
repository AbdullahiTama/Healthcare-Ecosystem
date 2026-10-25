import { describe, it, expect, vi } from 'vitest'
import { buildBboxQuery, parseOsmBusinesses, suggestCategory, fetchOsmBusinesses, safeWebsite } from '../osmBusinesses.js'

// OpenStreetMap businesses for the admin's directory map: only the kinds the platform directory manages.

const CATEGORIES = [
  'Pharmacy', 'Hospital', 'Clinic', 'Medical Centre', 'Primary Healthcare Centre', 'Maternity', 'Paediatric Centre',
  'Dental Clinic', 'Eye Clinic/Optometry', 'Medical Laboratory', 'Physiotherapy/Rehabilitation', 'Medical Equipment Supplier',
  'Cosmetics Business', 'Cardiology Centre',
].map((name, i) => ({ id: 'c' + i, name, is_active: true, business_id: null }))
const byName = (n) => CATEGORIES.find((c) => c.name === n)

describe('suggestCategory', () => {
  const cases = [
    [{ amenity: 'pharmacy' }, 'Pharmacy'],
    [{ shop: 'chemist' }, 'Pharmacy'],
    [{ amenity: 'hospital' }, 'Hospital'],
    [{ amenity: 'clinic' }, 'Clinic'],
    [{ amenity: 'doctors' }, 'Clinic'],
    [{ amenity: 'dentist' }, 'Dental Clinic'],
    [{ shop: 'optician' }, 'Eye Clinic/Optometry'],
    [{ healthcare: 'laboratory' }, 'Medical Laboratory'],
    [{ healthcare: 'physiotherapist' }, 'Physiotherapy/Rehabilitation'],
    [{ amenity: 'birthing_center' }, 'Maternity'],
    [{ amenity: 'health_post' }, 'Primary Healthcare Centre'],
    [{ healthcare: 'centre' }, 'Medical Centre'],
    [{ shop: 'medical_supply' }, 'Medical Equipment Supplier'],
    [{ shop: 'cosmetics' }, 'Cosmetics Business'],
    [{ amenity: 'clinic', 'healthcare:speciality': 'paediatrics' }, 'Paediatric Centre'],
    [{ amenity: 'hospital', 'healthcare:speciality': 'cardiology;general' }, 'Cardiology Centre'],
  ]
  for (const [tags, expected] of cases) {
    it(JSON.stringify(tags) + ' -> ' + expected, () => { expect(suggestCategory(tags, CATEGORIES)).toBe(byName(expected)) })
  }

  it('a kind the platform does not manage, or an inactive or missing category, gives nothing', () => {
    expect(suggestCategory({ shop: 'supermarket' }, CATEGORIES)).toBeNull()
    expect(suggestCategory({ amenity: 'pharmacy' }, CATEGORIES.filter((c) => c.name !== 'Pharmacy'))).toBeNull()
    expect(suggestCategory({ amenity: 'pharmacy' }, CATEGORIES.map((c) => (c.name === 'Pharmacy' ? { ...c, is_active: false } : c)))).toBeNull()
  })

  it('category names match regardless of case', () => {
    expect(suggestCategory({ amenity: 'pharmacy' }, [{ id: 'p', name: 'PHARMACY', is_active: true }]).id).toBe('p')
  })
})

describe('parseOsmBusinesses', () => {
  const data = { elements: [
    { type: 'node', id: 1, lat: 6.45, lon: 3.39, tags: { name: 'Allen Pharmacy', amenity: 'pharmacy', 'addr:housenumber': '12', 'addr:street': 'Allen Avenue', 'addr:city': 'Ikeja', 'addr:state': 'Lagos', phone: '+234 801 234 5678', website: 'https://allen.example', opening_hours: 'Mo-Sa 08:00-20:00' } },
    { type: 'way', id: 2, center: { lat: 6.5, lon: 3.4 }, tags: { name: 'Mercy Hospital', amenity: 'hospital', 'contact:phone': '0802' } },
    { type: 'node', id: 3, lat: 6.51, lon: 3.41, tags: { amenity: 'pharmacy' } },
    { type: 'node', id: 1, lat: 6.45, lon: 3.39, tags: { name: 'Allen Pharmacy', amenity: 'pharmacy' } },
    { type: 'node', id: 4, tags: { name: 'No position', amenity: 'clinic' } },
  ] }
  const rows = parseOsmBusinesses(data)

  it('keeps named elements with a position, once each, with their reference and details', () => {
    expect(rows.map((r) => r.ref)).toEqual(['node/1', 'way/2'])
    expect(rows[0]).toMatchObject({
      name: 'Allen Pharmacy', lat: 6.45, lng: 3.39, address: '12 Allen Avenue, Ikeja', state: 'Lagos', city: 'Ikeja',
      phone: '+234 801 234 5678', website: 'https://allen.example', openingHours: 'Mo-Sa 08:00-20:00',
    })
    expect(rows[1]).toMatchObject({ lat: 6.5, lng: 3.4, phone: '0802' })
    expect(rows[0].tags.amenity).toBe('pharmacy')
  })

  it('tolerates an empty or broken answer', () => {
    expect(parseOsmBusinesses(null)).toEqual([])
    expect(parseOsmBusinesses({})).toEqual([])
  })
})

describe('buildBboxQuery and fetchOsmBusinesses', () => {
  const B = { south: 6.4, west: 3.3, north: 6.6, east: 3.5 }

  it('asks for the healthcare kinds in the visible box, capped at 300', () => {
    const q = buildBboxQuery(B)
    expect(q).toContain('(6.4,3.3,6.6,3.5)')
    expect(q).toContain('["amenity"~"')
    expect(q).toContain('["healthcare"]')
    expect(q).toContain('["shop"~"')
    expect(q).toContain('out center 300;')
  })

  it('posts the query to Overpass and parses the answer', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ elements: [{ type: 'node', id: 9, lat: 1, lon: 2, tags: { name: 'X', amenity: 'clinic' } }] }) }))
    const rows = await fetchOsmBusinesses(B, { fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://overpass-api.de/api/interpreter')
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST')
    expect(rows.map((r) => r.ref)).toEqual(['node/9'])
  })

  it('a busy or unreachable Overpass gives one plain message', async () => {
    await expect(fetchOsmBusinesses(B, { fetchImpl: async () => ({ ok: false, status: 429 }) })).rejects.toThrow('OpenStreetMap is busy or unreachable. Try again in a moment.')
    await expect(fetchOsmBusinesses(B, { fetchImpl: async () => { throw new TypeError('Failed to fetch') } })).rejects.toThrow('OpenStreetMap is busy or unreachable. Try again in a moment.')
  })
})

describe('safeWebsite', () => {
  it('only http(s) addresses become links', () => {
    expect(safeWebsite('https://allen.example')).toBe('https://allen.example')
    expect(safeWebsite('http://x.example/a')).toBe('http://x.example/a')
    expect(safeWebsite('javascript:alert(1)')).toBeNull()
    expect(safeWebsite('allen.example')).toBeNull()
    expect(safeWebsite('')).toBeNull()
  })
})

describe('fetchOsmBusinesses failures say which kind they are', () => {
  const B = { south: 6.4, west: 3.3, north: 6.6, east: 3.5 }
  it('a 400 means OpenStreetMap could not read the search (a fault on our side), and keeps the status', async () => {
    await expect(fetchOsmBusinesses(B, { fetchImpl: async () => ({ ok: false, status: 400 }) })).rejects.toMatchObject({ message: 'OpenStreetMap could not read this search. Please report it to the CareHub team.', status: 400 })
  })
  it('a refusal or overload keeps its status for diagnosis', async () => {
    await expect(fetchOsmBusinesses(B, { fetchImpl: async () => ({ ok: false, status: 406 }) })).rejects.toMatchObject({ message: 'OpenStreetMap is busy or unreachable. Try again in a moment.', status: 406 })
  })
})
