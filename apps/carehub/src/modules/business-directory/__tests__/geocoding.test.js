import { describe, it, expect, beforeEach } from 'vitest'
import { geocodePlace, clearGeocodeCache } from '../services/geocoding'

const ok = (data) => async () => ({ ok: true, status: 200, json: async () => data })

describe('geocodePlace', () => {
  beforeEach(clearGeocodeCache)

  it('returns coordinates from the service response', async () => {
    const r = await geocodePlace('Surulere', { fetchImpl: ok([{ lat: '6.5', lon: '3.35', display_name: 'Surulere, Lagos' }]) })
    expect(r).toEqual({ lat: 6.5, lng: 3.35, label: 'Surulere, Lagos' })
  })

  it('returns null — never a guess — when nothing is found', async () => {
    expect(await geocodePlace('Nowhereville', { fetchImpl: ok([]) })).toBeNull()
  })

  it('caches answers, including "not found"', async () => {
    let calls = 0
    const f = async () => { calls++; return { ok: true, json: async () => [] } }
    await geocodePlace('Nowhere', { fetchImpl: f })
    await geocodePlace('  nowhere ', { fetchImpl: f })
    expect(calls).toBe(1)
  })

  it('throws on service failure so callers can tell it from "not found", and does not cache the failure', async () => {
    await expect(geocodePlace('Yaba', { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('503')
    expect(await geocodePlace('Yaba', { fetchImpl: ok([{ lat: '6.5', lon: '3.37' }]) })).toMatchObject({ lat: 6.5 })
  })

  it('is restricted to Nigeria by default', async () => {
    let url = ''
    await geocodePlace('Ikeja', { fetchImpl: async (u) => { url = u; return { ok: true, json: async () => [] } } })
    expect(url).toContain('countrycodes=ng')
  })
})
