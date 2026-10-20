import { describe, it, expect, vi } from 'vitest'
import { createAreaLookup, areaLabelFromAddress, OSM_ATTRIBUTION } from './areaLookup'

// Nominatim's policy: at most one request per second, cache results, show
// attribution. These tests drive the lookup with a fake clock so no real waiting
// or network is involved.

const body = (address, display_name) => ({ address, display_name })
const okFetch = (data) => vi.fn(async () => ({ ok: true, json: async () => data }))

function harness(fetchImpl) {
  let t = 1_000_000
  const sleeps = []
  const lookup = createAreaLookup({
    fetchImpl,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms },
    gapMs: 1100,
  })
  return { lookup, sleeps, advance: (ms) => { t += ms } }
}

describe('areaLabelFromAddress', () => {
  it('builds a short caption from the address parts', () => {
    expect(areaLabelFromAddress({ road: 'Allen Avenue', suburb: 'Ikeja', city: 'Lagos' })).toBe('Allen Avenue, Ikeja, Lagos')
    expect(areaLabelFromAddress({ amenity: 'Allen Pharmacy', road: 'Allen Avenue', town: 'Ikeja' })).toBe('Allen Pharmacy, Allen Avenue, Ikeja')
  })
  it('is empty when there is nothing usable, rather than inventing a name', () => {
    expect(areaLabelFromAddress({})).toBe('')
    expect(areaLabelFromAddress(null)).toBe('')
  })
})

describe('area lookup', () => {
  it('returns a label and says it came from OpenStreetMap data', async () => {
    const { lookup } = harness(okFetch(body({ road: 'Allen Avenue', city: 'Lagos' })))
    const r = await lookup(6.5, 3.4)
    expect(r).toEqual({ status: 'ok', label: 'Allen Avenue, Lagos' })
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap')
  })

  it('"nothing found" is a result, not a failure', async () => {
    const { lookup } = harness(okFetch({ error: 'Unable to geocode' }))
    expect(await lookup(0.1, 0.1)).toEqual({ status: 'no_result' })
  })

  it('a service error throws, so "service down" is never confused with "no name here"', async () => {
    const { lookup } = harness(vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(lookup(6.5, 3.4)).rejects.toThrow(/503/)
  })

  it('a network failure throws', async () => {
    const { lookup } = harness(vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(lookup(6.5, 3.4)).rejects.toThrow('Failed to fetch')
  })

  it('caches by place (about 100 m), so the same spot is one request', async () => {
    const f = okFetch(body({ road: 'Allen Avenue' }))
    const { lookup } = harness(f)
    await lookup(6.50001, 3.40001)
    await lookup(6.50004, 3.40003) // a few metres away
    await lookup(6.50001, 3.40001)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('caches "nothing found" too, and does not cache a failure', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ error: 'none' }) })
    const { lookup, advance } = harness(f)
    await expect(lookup(1, 1)).rejects.toThrow('offline')
    advance(5000)
    expect(await lookup(1, 1)).toEqual({ status: 'no_result' })
    await lookup(1, 1)
    expect(f).toHaveBeenCalledTimes(2) // the retry, then the cached "no result"
  })

  it('spaces different places at least a second apart', async () => {
    const f = okFetch(body({ road: 'X' }))
    const { lookup, sleeps } = harness(f)
    await lookup(6.5, 3.4)
    await lookup(7.5, 4.4)
    expect(sleeps.length).toBe(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000)
  })

  it('two requests at once for the same spot share one call', async () => {
    const f = okFetch(body({ road: 'Allen Avenue' }))
    const { lookup } = harness(f)
    const [a, b] = await Promise.all([lookup(6.5, 3.4), lookup(6.5, 3.4)])
    expect(a).toEqual(b)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('refuses coordinates that are not real, without calling the service', async () => {
    const f = okFetch(body({ road: 'X' }))
    const { lookup } = harness(f)
    expect(await lookup(NaN, 3)).toEqual({ status: 'no_result' })
    expect(await lookup(95, 3)).toEqual({ status: 'no_result' })
    expect(f).not.toHaveBeenCalled()
  })
})
