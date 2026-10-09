import { describe, it, expect } from 'vitest'
import { searchBusinesses, sortResults, findNearbyBusinesses, radiusForAccuracy, NEARBY_LABELS } from '../services/search'
import { createDirectoryRepository } from '../repositories'
import { createInMemoryClient } from '../../../test/inMemoryClient'

const A = 'biz-A'
const mk = (id, lat, lng, extra = {}) => ({ id, business_id: A, name: id, name_normalized: id, latitude: lat, longitude: lng, is_active: true, verification_status: 'unverified', created_at: '2026-01-01', ...extra })

function repoWith(rows) {
  const client = createInMemoryClient({ directory_businesses: rows })
  return { repo: createDirectoryRepository(client), client }
}

describe('searchBusinesses', () => {
  const rows = [
    mk('near', 6.5, 3.4, { verification_status: 'verified', category_id: 'ph' }),
    mk('mid', 6.52, 3.4, { category_id: 'ph' }),
    mk('edge', 6.54, 3.4, { category_id: 'ph' }), // ≈ 4.4 km
    mk('outside', 6.6, 3.4, { category_id: 'ph' }), // ≈ 11 km
    mk('nocoords', null, null, { category_id: 'ph' }),
    mk('wrongcat', 6.5, 3.4001, { category_id: 'hosp' }),
  ]

  it('radius search trims the bounding box to the true circle and sorts nearest first', async () => {
    const { repo } = repoWith(rows)
    const out = await searchBusinesses(repo, A, { center: { lat: 6.5, lng: 3.4 }, radiusKm: 5, categoryId: 'ph' })
    expect(out.mode).toBe('radius')
    expect(out.results.map((r) => r.id)).toEqual(['near', 'mid', 'edge'])
    expect(out.results[0].distance_km).toBeCloseTo(0, 3)
  })

  it('never returns a business with no coordinates in a radius search', async () => {
    const { repo } = repoWith(rows)
    const out = await searchBusinesses(repo, A, { center: { lat: 6.5, lng: 3.4 }, radiusKm: 50 })
    expect(out.results.find((r) => r.id === 'nocoords')).toBeUndefined()
  })

  it('quantity caps the list but reports the true total', async () => {
    const { repo } = repoWith(rows)
    const out = await searchBusinesses(repo, A, { center: { lat: 6.5, lng: 3.4 }, radiusKm: 5, categoryId: 'ph', quantity: 2 })
    expect(out.results).toHaveLength(2)
    expect(out.total).toBe(3)
    expect(out.truncated).toBe(true)
  })

  it('quantity picks the nearest N even when displayed alphabetically', async () => {
    const { repo } = repoWith([mk('zulu', 6.5, 3.4), mk('alpha', 6.52, 3.4), mk('mike', 6.54, 3.4)])
    const out = await searchBusinesses(repo, A, { center: { lat: 6.5, lng: 3.4 }, radiusKm: 10, quantity: 2, sort: 'alpha' })
    expect(out.results.map((r) => r.id)).toEqual(['alpha', 'zulu']) // nearest two, then A–Z
  })

  it('says nothing was found rather than inventing results', async () => {
    const { repo } = repoWith(rows)
    const out = await searchBusinesses(repo, A, { center: { lat: 9, lng: 9 }, radiusKm: 1 })
    expect(out.results).toEqual([])
  })

  it('falls back to place-name text matching, without distances', async () => {
    const { repo } = repoWith([mk('s1', null, null, { lga: 'Surulere' }), mk('s2', 6, 3, { city: 'Ikeja' })])
    const out = await searchBusinesses(repo, A, { placeName: 'surulere' })
    expect(out.mode).toBe('place_text')
    expect(out.results.map((r) => r.id)).toEqual(['s1'])
    expect(out.results[0].distance_km).toBeNull()
  })
})

describe('sortResults', () => {
  const r = [
    { name: 'b', name_normalized: 'b', distance_km: 3, created_at: '2026-02-01', verification_status: 'unverified' },
    { name: 'a', name_normalized: 'a', distance_km: 9, created_at: '2026-03-01', verification_status: 'verified' },
    { name: 'c', name_normalized: 'c', distance_km: 1, created_at: '2026-01-01', verification_status: 'rejected' },
    { name: 'd', name_normalized: 'd', distance_km: null, created_at: '2026-04-01', verification_status: 'unverified' },
  ]
  const names = (s) => sortResults(r, s).map((x) => x.name).join('')
  it('nearest (unknown distance last)', () => expect(names('nearest')).toBe('cbad'))
  it('farthest (unknown distance last)', () => expect(names('farthest')).toBe('abcd'))
  it('alphabetical', () => expect(names('alpha')).toBe('abcd'))
  it('recently added', () => expect(names('recent')).toBe('dabc'))
  it('verified first, then by distance', () => expect(names('verified')).toBe('abdc'))
})

describe('findNearbyBusinesses (Live Field Report matcher)', () => {
  it('returns hints within the GPS uncertainty only, nearest first', async () => {
    const { repo } = repoWith([mk('here', 6.5, 3.4), mk('next', 6.5008, 3.4), mk('far', 6.52, 3.4)])
    const out = await findNearbyBusinesses(repo, A, { lat: 6.5, lng: 3.4, accuracy: 30 })
    expect(out.candidates.map((c) => c.id)).toEqual(['here', 'next'])
  })
  it('radius widens with a poor fix but is bounded', () => {
    expect(radiusForAccuracy(10)).toBe(0.2)
    expect(radiusForAccuracy(400)).toBeCloseTo(0.6)
    expect(radiusForAccuracy(5000)).toBe(1)
    expect(radiusForAccuracy(undefined)).toBe(0.2)
  })
  it('never claims a visit', () => {
    expect(Object.values(NEARBY_LABELS).join(' ').toLowerCase()).not.toMatch(/visited|checked in|arrived/)
  })
  it('is read-only: it only issues GETs', async () => {
    const methods = []
    const repo = createDirectoryRepository(async (p, o) => { methods.push(o?.method || 'GET'); return [] })
    await findNearbyBusinesses(repo, A, { lat: 6.5, lng: 3.4, accuracy: 20 })
    await searchBusinesses(repo, A, { center: { lat: 6.5, lng: 3.4 }, radiusKm: 3 })
    expect(new Set(methods)).toEqual(new Set(['GET']))
  })
})
