import { describe, it, expect, vi } from 'vitest'
import {
  parseSearchText, buildSearchParams, interpretationToFilters, parseCustomRadiusKm, RADIUS_OPTIONS_M,
} from './searchQuery.js'
import { captureLocation, LOW_ACCURACY_M } from './locationCapture.js'
import { directionsUrl, viewOnMapUrl, distanceLabel } from './mapsLinks.js'
import { buildDirectoryCsv, createDiscoveryService, EXPORT_CAP } from './discoveryService.js'

describe('parseSearchText', () => {
  it('"Find pharmacies around me"', () => {
    const p = parseSearchText('Find pharmacies around me.')
    expect(p).toMatchObject({ categorySlug: 'pharmacy', near: 'me', radiusM: null, limit: null, q: null })
    expect(p.needsReview).toBe(false)
  })
  it('"Find hospitals within 5 km"', () => {
    expect(parseSearchText('Find hospitals within 5 km')).toMatchObject({ categorySlug: 'hospital', radiusM: 5000 })
  })
  it('"Show me 20 cosmetic businesses around Surulere": Surulere is an LGA in more than one state, so no state is guessed', () => {
    const p = parseSearchText('Show me 20 cosmetic businesses around Surulere')
    expect(p).toMatchObject({ categorySlug: 'cosmetics', limit: 20, lga: 'Surulere', state: null, needsReview: true })
    expect(p.notes.join(' ')).toMatch(/several states/)
  })
  it('an LGA that exists in one state resolves that state', () => {
    const p = parseSearchText('clinics in Ikeja')
    expect(p).toMatchObject({ categorySlug: 'clinic', lga: 'Ikeja' })
    expect(p.state).toBeTruthy()
  })
  it('"Find pharmaceutical distributors in Lagos"', () => {
    expect(parseSearchText('Find pharmaceutical distributors in Lagos')).toMatchObject({ categorySlug: 'pharma-distributor', state: 'Lagos' })
  })
  it('specific categories win over generic ones', () => {
    expect(parseSearchText('medical equipment suppliers in Abuja').categorySlug).toBe('medical-equipment-supplier')
    expect(parseSearchText('eye clinics near me').categorySlug).toBe('eye-clinic')
    expect(parseSearchText('diagnostic centres in Ibadan').categorySlug).toBe('diagnostic-imaging')
  })
  it('treats an unknown place as text, never as coordinates', () => {
    const p = parseSearchText('clinics in Okpoko Market')
    expect(p.place).toBe('Okpoko Market')
    expect(p.notes.join(' ')).toMatch(/not geocoded/)
  })
  it('flags an ambiguous LGA name for review', () => {
    const multi = parseSearchText('hospitals in Bassa')
    if (multi.lga) { expect(multi.state ? true : multi.needsReview).toBe(true) }
  })
  it('ignores an out-of-range radius and says so', () => {
    const p = parseSearchText('pharmacies within 500 km')
    expect(p.radiusM).toBeNull()
    expect(p.notes.join(' ')).toMatch(/100 km/)
  })
  it('warns when a radius has no location', () => {
    expect(parseSearchText('pharmacies within 3 km').notes.join(' ')).toMatch(/needs a location/)
  })
  it('keeps unknown words as a name fragment and asks for review on gibberish-free empty input', () => {
    expect(parseSearchText('Alpha').q).toBe('alpha')
    expect(parseSearchText('   ').needsReview).toBe(true)
    expect(parseSearchText('find me').needsReview).toBe(true)
  })
  it('maps an interpretation to filters, dropping a category slug it cannot resolve', () => {
    const cats = [{ id: 'c1', slug: 'pharmacy' }]
    expect(interpretationToFilters(parseSearchText('pharmacies around me'), cats)).toMatchObject({ categoryId: 'c1', wantsMyLocation: true })
    expect(interpretationToFilters(parseSearchText('hospitals around me'), cats).categoryId).toBe('')
  })
})

describe('buildSearchParams', () => {
  it('maps filters to RPC params and clamps limit and offset', () => {
    const { params, error } = buildSearchParams({ q: ' alpha ', categoryId: 'c1', lat: '6.5', lng: '3.4', radiusM: 3000, limit: 5000, offset: -9 })
    expect(error).toBeNull()
    expect(params).toMatchObject({ p_q: 'alpha', p_category_id: 'c1', p_lat: 6.5, p_lng: 3.4, p_radius_m: 3000, p_limit: 100, p_offset: 0, p_sort: 'distance' })
  })
  it('refuses a half-supplied or out-of-range point instead of widening the search', () => {
    expect(buildSearchParams({ lat: 6.5 }).error).toBeTruthy()
    expect(buildSearchParams({ lat: 95, lng: 3 }).error).toBeTruthy()
    expect(buildSearchParams({ lat: 'x', lng: 3 }).error).toBeTruthy()
  })
  it('rejects a radius outside 100 m - 100 km', () => {
    expect(buildSearchParams({ lat: 6, lng: 3, radiusM: 50 }).error).toBeTruthy()
    expect(buildSearchParams({ lat: 6, lng: 3, radiusM: 200000 }).error).toBeTruthy()
  })
  it('sends no point or radius for a non-location search, and sorts by name', () => {
    const { params } = buildSearchParams({ state: 'Lagos' })
    expect(params).toMatchObject({ p_lat: null, p_lng: null, p_radius_m: null, p_sort: 'name', p_state: 'Lagos' })
  })
  it('falls back from an unknown sort', () => {
    expect(buildSearchParams({ sort: 'x; drop' }).params.p_sort).toBe('name')
  })
  it('offers the required radii and validates a custom one', () => {
    expect(RADIUS_OPTIONS_M).toEqual([1000, 3000, 5000, 10000, 25000])
    expect(parseCustomRadiusKm('7.5')).toBe(7500)
    expect(parseCustomRadiusKm('0.05')).toBeNull()
    expect(parseCustomRadiusKm('101')).toBeNull()
    expect(parseCustomRadiusKm('abc')).toBeNull()
    expect(parseCustomRadiusKm('')).toBeNull()
  })
})

describe('captureLocation', () => {
  const geo = (impl) => ({ getCurrentPosition: impl })
  it('returns a position with accuracy and a timestamp', async () => {
    const r = await captureLocation({ geolocation: geo((ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 20 } })), now: () => new Date('2026-10-19T10:00:00Z') })
    expect(r).toMatchObject({ ok: true, lat: 6.5, lng: 3.4, accuracyM: 20, lowAccuracy: false, capturedAt: '2026-10-19T10:00:00.000Z' })
  })
  it('flags low accuracy but still returns the position', async () => {
    const r = await captureLocation({ geolocation: geo((ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: LOW_ACCURACY_M + 1 } })) })
    expect(r).toMatchObject({ ok: true, lowAccuracy: true })
  })
  it('reports denied, unavailable and timeout honestly', async () => {
    for (const [code, reason] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
      const r = await captureLocation({ geolocation: geo((_, bad) => bad({ code })) })
      expect(r).toMatchObject({ ok: false, reason })
      expect(r.message.length).toBeGreaterThan(10)
    }
  })
  it('reports an unsupported browser', async () => {
    expect(await captureLocation({ geolocation: undefined })).toMatchObject({ ok: false, reason: 'unsupported' })
  })
  it('rejects missing or out-of-range coordinates rather than returning them', async () => {
    expect(await captureLocation({ geolocation: geo((ok) => ok({ coords: { latitude: null, longitude: null } })) })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await captureLocation({ geolocation: geo((ok) => ok({ coords: { latitude: 120, longitude: 3 } })) })).toMatchObject({ ok: false, reason: 'invalid' })
  })
  it('gives up if the browser never calls back', async () => {
    vi.useFakeTimers()
    const p = captureLocation({ timeoutMs: 1000, geolocation: geo(() => {}) })
    await vi.advanceTimersByTimeAsync(3500)
    expect(await p).toMatchObject({ ok: false, reason: 'timeout' })
    vi.useRealTimers()
  })
})

describe('maps links and distance labels', () => {
  it('builds a directions URL to the exact coordinates', () => {
    expect(directionsUrl(6.5244, 3.3792)).toBe('https://www.google.com/maps/dir/?api=1&destination=6.5244%2C3.3792')
    expect(viewOnMapUrl('6.5', '3.4')).toContain('query=6.5%2C3.4')
  })
  it('returns null for missing or invalid coordinates so no wrong link is shown', () => {
    expect(directionsUrl(null, null)).toBeNull()
    expect(directionsUrl('', '')).toBeNull()
    expect(directionsUrl(91, 0)).toBeNull()
    expect(viewOnMapUrl(undefined, 3)).toBeNull()
  })
  it('always states that the distance is straight-line', () => {
    expect(distanceLabel(3200)).toBe('3.2 km straight-line')
    expect(distanceLabel(450)).toBe('450 m straight-line')
    expect(distanceLabel(null)).toBe('')
  })
})

describe('CSV export', () => {
  it('quotes, neutralises spreadsheet formulas and omits private fields', () => {
    const csv = buildDirectoryCsv([
      { name: '=HYPERLINK("http://evil")', category_id: 'c1', address: 'A, "B"', verification_status: 'verified', data_source: 'manual', contact_person: 'Secret', latitude: 6.5, longitude: 3.4, distance_m: 120 },
    ], [{ id: 'c1', name: 'Pharmacies' }])
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"")
    expect(csv).toContain('"A, ""B"""')
    expect(csv).toContain('Pharmacies')
    expect(csv).not.toContain('Secret')
    expect(csv.split('\r\n')[0]).toContain('Straight-line distance (m)')
  })
})

describe('discovery service', () => {
  const page = (n, hasMore, total) => ({ rows: Array.from({ length: n }, (_, i) => ({ id: 'r' + i })), total, hasMore })

  it('search validates before any request and is read-only', async () => {
    const repo = { discover: vi.fn() }
    const svc = createDiscoveryService(repo)
    await expect(svc.search({ lat: 6.5 })).rejects.toThrow(/coordinates/i)
    expect(repo.discover).not.toHaveBeenCalled()
    expect(Object.keys(repo)).toEqual(['discover'])
  })

  it('export walks the same filters page by page and reports truncation at the cap', async () => {
    const repo = { discover: vi.fn(async (p) => page(100, true, 5000)) }
    const svc = createDiscoveryService(repo)
    const out = await svc.exportAll({ state: 'Lagos' })
    expect(out.rows).toHaveLength(EXPORT_CAP)
    expect(out.truncated).toBe(true)
    expect(out.total).toBe(5000)
    expect(repo.discover.mock.calls.every(([p]) => p.p_state === 'Lagos' && p.p_limit === 100)).toBe(true)
    expect(repo.discover.mock.calls.map(([p]) => p.p_offset).slice(0, 3)).toEqual([0, 100, 200])
  })

  it('export of a small result is complete and not truncated', async () => {
    const repo = { discover: vi.fn().mockResolvedValueOnce(page(100, true, 130)).mockResolvedValueOnce(page(30, false, 130)) }
    const out = await createDiscoveryService(repo).exportAll({})
    expect(out).toMatchObject({ total: 130, truncated: false })
    expect(out.rows).toHaveLength(130)
  })
})
