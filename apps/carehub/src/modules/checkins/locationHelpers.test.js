import { describe, it, expect, vi } from 'vitest'
import { captureLocation, LOW_ACCURACY_M } from './locationCapture.js'
import { directionsUrl, viewOnMapUrl, distanceLabel } from './mapsLinks.js'

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
