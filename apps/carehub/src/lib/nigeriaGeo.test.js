import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NIGERIA_STATES, getLgasForState, normalizeState, resolveLocation, STATE_CENTRES } from './nigeriaGeo.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('Atlantis')) return { ok: true, json: async () => [] }
    if (u.includes('Ikeja')) return { ok: true, json: async () => [{ lat: '6.6018', lon: '3.3517', display_name: 'Ikeja, Lagos, Nigeria', boundingbox: ['6.5','6.7','3.3','3.4'], address: { state: 'Lagos', city: 'Ikeja' } }] }
    if (u.includes('Lagos')) return { ok: true, json: async () => [{ lat: '6.5244', lon: '3.3792', display_name: 'Lagos, Nigeria', boundingbox: ['6.3','6.7','3.1','3.6'], address: { state: 'Lagos' } }] }
    return { ok: true, json: async () => [] }
  }))
})

describe('nigeriaGeo', () => {
  it('has 37 states (36 + FCT)', () => {
    expect(NIGERIA_STATES.length).toBe(37)
    const names = NIGERIA_STATES.map(s => s.name)
    expect(names).toContain('Lagos')
    expect(names).toContain('FCT')
    expect(names).toContain('Kano')
    expect(names).not.toContain('FCT - Abuja')
  })
  it('has 774 LGAs total', () => {
    const total = NIGERIA_STATES.reduce((sum, s) => sum + s.lgas.length, 0)
    expect(total).toBe(774)
  })
  it('Lagos has 20 LGAs', () => {
    expect(getLgasForState('Lagos').length).toBe(20)
    expect(getLgasForState('lagos')).toContain('Ikeja')
  })
  it('Kano has 44 LGAs', () => {
    expect(getLgasForState('Kano').length).toBe(44)
  })
  it('Bayelsa has 8, FCT has 6', () => {
    expect(getLgasForState('Bayelsa').length).toBe(8)
    expect(getLgasForState('FCT').length).toBe(6)
    expect(getLgasForState('FCT - Abuja').length).toBe(6)
    expect(getLgasForState('Federal Capital Territory').length).toBe(6)
  })
  it('normalizeState handles variants case-insensitive', () => {
    expect(normalizeState('lagos')).toBe('Lagos')
    expect(normalizeState('LAGOS')).toBe('Lagos')
    expect(normalizeState('FCT - Abuja')).toBe('FCT')
    expect(normalizeState('federal capital territory')).toBe('FCT')
    expect(normalizeState('FCT Abuja')).toBe('FCT')
    expect(normalizeState('  Ogun  ')).toBe('Ogun')
    expect(normalizeState('UnknownState')).toBeNull()
    expect(normalizeState('')).toBeNull()
  })
  it('normalizeState trims and preserves native names', () => {
    expect(normalizeState('Cross River')).toBe('Cross River')
    expect(normalizeState('cross river')).toBe('Cross River')
  })
  it('getLgasForState returns copy not reference', () => {
    const a = getLgasForState('Lagos')
    a.push('Fake')
    expect(getLgasForState('Lagos')).not.toContain('Fake')
  })
  it('resolveLocation Nigeria mode returns national centre', async () => {
    const r = await resolveLocation({ mode: 'nigeria' })
    expect(r.mode).toBe('nigeria')
    expect(r.centre.lat).toBeCloseTo(9.082, 0)
    expect(r.label).toBe('Nigeria')
    expect(r.boundary).toBeNull()
  })
  it('resolveLocation state mode returns state centre without GPS', async () => {
    const r = await resolveLocation({ mode: 'state', state: 'Lagos' })
    expect(r.state).toBe('Lagos')
    expect(r.centre).not.toBeNull()
    // Geocoded centre or fallback STATE_CENTRES both valid; just check plausible Lagos lat
    expect(r.centre.lat).toBeGreaterThan(6)
    expect(r.centre.lat).toBeLessThan(7)
  })
  it('resolveLocation lga mode returns lga and state', async () => {
    const r = await resolveLocation({ mode: 'lga', state: 'Lagos', lga: 'Ikeja' })
    expect(r.state).toBe('Lagos')
    expect(r.lga).toBe('Ikeja')
    expect(r.label).toContain('Ikeja')
  })
  it('resolveLocation current mode with coords returns centre', async () => {
    const r = await resolveLocation({ mode: 'current', coords: { lat: 6.5, lng: 3.3 } })
    expect(r.centre.lat).toBeCloseTo(6.5)
    expect(r.centre.lng).toBeCloseTo(3.3)
  })
  it('resolveLocation handles unknown state fallback', async () => {
    const r = await resolveLocation({ mode: 'state', state: 'Atlantis' })
    expect(r.state).toBeNull()
    // should still not throw
    expect(r.centre).toBeNull()
  })
})
