import { describe, it, expect } from 'vitest'
import { sortResults, findNearbyBusinesses, radiusForAccuracy, NEARBY_LABELS } from '../services/search'
import { createDirectoryRepository } from '../repositories'

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
  const row = (id, distance_km) => ({ id, name: id, address: '1 Road', business_type: 'pharmacy', verification_status: 'verified', distance_km })
  const repoReturning = (rows, seen = []) => ({ nearbyBusinesses: async (args) => { seen.push(args); return rows } })

  it('asks for the GPS fix, a radius that honours its uncertainty, and the limit, and returns nearest first', async () => {
    const seen = []
    const out = await findNearbyBusinesses(repoReturning([row('next', 0.09), row('here', 0.001)], seen), { lat: 6.5, lng: 3.4, accuracy: 30 })
    expect(seen).toEqual([{ lat: 6.5, lng: 3.4, radiusKm: radiusForAccuracy(30), limit: 5 }])
    expect(out.candidates.map((c) => c.id)).toEqual(['here', 'next'])
    expect(out.radiusKm).toBe(radiusForAccuracy(30))
  })

  it('never shows more than the requested limit, and treats a missing answer as nothing nearby', async () => {
    const many = Array.from({ length: 8 }, (_, i) => row('r' + i, i / 100))
    expect((await findNearbyBusinesses(repoReturning(many), { lat: 6.5, lng: 3.4, accuracy: 20, limit: 3 })).candidates).toHaveLength(3)
    expect((await findNearbyBusinesses(repoReturning(null), { lat: 6.5, lng: 3.4, accuracy: 20 })).candidates).toEqual([])
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

  it('goes through the bounded database function and nothing else', async () => {
    const calls = []
    const repo = createDirectoryRepository(async (path, opts) => { calls.push([path, opts?.method || 'GET', opts?.body]); return [] })
    await findNearbyBusinesses(repo, { lat: 6.5, lng: 3.4, accuracy: 20 })
    expect(calls).toEqual([['rpc/nearby_directory_businesses', 'POST', JSON.stringify({ p_lat: 6.5, p_lng: 3.4, p_radius_km: radiusForAccuracy(20), p_limit: 5 })]])
  })
})
