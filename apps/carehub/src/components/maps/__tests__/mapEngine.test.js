import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  openMap, loadGoogleMaps, resetGoogleMapsLoader, notifyGoogleAuthFailure, resolveLeaflet, createGoogleEngine,
} from '@care-ecosystem/design-system/components/maps/mapEngine'

// The shared map engine (packages/design-system): which provider a screen gets, what it asks each provider to draw,
// and the fallback to OpenStreetMap when Google is missing, fails to load, or rejects the key.

function fakeGoogle() {
  const calls = { markers: [], fitBounds: [], setCenter: [], setZoom: [], infoOpen: [], cleared: 0 }
  const listeners = {}
  let zoom = 11
  class Map {
    constructor(el, opts) { this.el = el; this.opts = opts; zoom = opts.zoom }
    addListener(ev, fn) { listeners[ev] = fn; return { remove: () => { delete listeners[ev] } } }
    getBounds() { return { getSouthWest: () => ({ lat: () => 6.4, lng: () => 3.3 }), getNorthEast: () => ({ lat: () => 6.6, lng: () => 3.5 }) } }
    getZoom() { return zoom }
    setZoom(z) { zoom = z; calls.setZoom.push(z) }
    setCenter(c) { calls.setCenter.push(c) }
    fitBounds(b, pad) { calls.fitBounds.push({ points: b.points, pad }); zoom = 18 }
  }
  class Marker {
    constructor(opts) { this.opts = opts; this.map = opts.map; this.handlers = {}; calls.markers.push(this) }
    addListener(ev, fn) { this.handlers[ev] = fn }
    setMap(m) { this.map = m }
  }
  class InfoWindow {
    setContent(c) { this.content = c }
    open(o) { calls.infoOpen.push({ content: this.content, anchor: o.anchor }) }
    close() {}
  }
  class LatLngBounds { constructor() { this.points = [] } extend(p) { this.points.push(p) } }
  const gm = {
    Map, Marker, InfoWindow, LatLngBounds, SymbolPath: { CIRCLE: 0 },
    event: { addListenerOnce: (_m, _ev, fn) => fn(), clearInstanceListeners: () => { calls.cleared++ } },
  }
  return { gm, calls, listeners }
}

function fakeLeaflet() {
  const state = { markers: [], fitBounds: [], setView: [], removed: 0, handlers: {} }
  const L = {
    map: (el, opts) => {
      const m = {
        opts,
        on: (ev, fn) => { state.handlers[ev] = fn; return m },
        off: () => m,
        getBounds: () => ({ getSouth: () => 1, getWest: () => 2, getNorth: () => 3, getEast: () => 4 }),
        getZoom: () => 9,
        setView: (...a) => { state.setView.push(a); return m },
        fitBounds: (...a) => { state.fitBounds.push(a); return m },
        remove: () => { state.removed++ },
      }
      state.map = m
      return m
    },
    tileLayer: (url, opts) => { state.tiles = { url, opts }; return { addTo: () => {} } },
    layerGroup: () => ({ addTo() { return this }, clearLayers: () => { state.markers = [] } }),
    circleMarker: (latlng, opts) => {
      const mk = { latlng, opts, handlers: {} }
      mk.bindPopup = (p) => { mk.popup = p; return mk }
      mk.on = (ev, fn) => { mk.handlers[ev] = fn; return mk }
      mk.addTo = () => { state.markers.push(mk); return mk }
      return mk
    },
  }
  return { L, state }
}

const el = () => document.createElement('div')
const MARKERS = [
  { lat: 6.45, lng: 3.39, color: '#0f766e', title: 'Allen Pharmacy', popup: document.createElement('div'), onClick: vi.fn() },
  { lat: 6.46, lng: 3.40, color: '#6b7280', title: 'Mercy Clinic' },
]

let warn
const opened = []
// Every map a test opens is destroyed afterwards, so a later simulated key rejection only reaches its own test's map.
const track = async (p) => { const m = await p; opened.push(m); return m }
beforeEach(() => { resetGoogleMapsLoader(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { opened.splice(0).forEach((m) => m.destroy()); warn.mockRestore() })

describe('openMap: choosing the provider', () => {
  it('uses OpenStreetMap when there is no Google key, and never loads Google', async () => {
    const { L, state } = fakeLeaflet()
    const loadGoogle = vi.fn()
    const map = await track(openMap(el(), { googleApiKey: '', loadLeaflet: async () => ({ default: L }), loadGoogle }))
    expect(map.provider).toBe('leaflet')
    expect(loadGoogle).not.toHaveBeenCalled()
    expect(state.tiles.url).toContain('tile.openstreetmap.org')
    expect(state.tiles.opts.attribution).toContain('OpenStreetMap contributors')
  })

  it('uses Google Maps when a key is configured, and never loads Leaflet', async () => {
    const { gm } = fakeGoogle()
    const loadLeaflet = vi.fn()
    const map = await track(openMap(el(), { googleApiKey: 'k', loadLeaflet, loadGoogle: async () => gm }))
    expect(map.provider).toBe('google')
    expect(loadLeaflet).not.toHaveBeenCalled()
  })

  it('falls back to OpenStreetMap when Google cannot be loaded', async () => {
    const { L } = fakeLeaflet()
    const map = await track(openMap(el(), { googleApiKey: 'k', loadLeaflet: async () => L, loadGoogle: async () => { throw new Error('offline') } }))
    expect(map.provider).toBe('leaflet')
  })

  it('switches to OpenStreetMap when Google rejects the key, redrawing the same markers, view and listener', async () => {
    const { gm } = fakeGoogle()
    const { L, state } = fakeLeaflet()
    const onView = vi.fn()
    const map = await track(openMap(el(), { googleApiKey: 'k', loadLeaflet: async () => L, loadGoogle: async () => gm }))
    map.setMarkers(MARKERS)
    map.fitTo(MARKERS, { maxZoom: 16 })
    map.onViewChange(onView)
    notifyGoogleAuthFailure()
    await vi.waitFor(() => expect(map.provider).toBe('leaflet'))
    expect(state.markers).toHaveLength(2)
    expect(state.fitBounds).toHaveLength(1)
    expect(onView).toHaveBeenLastCalledWith({ south: 1, west: 2, north: 3, east: 4 }, 9)
  })

  it('if the fallback cannot load either, the rejection is contained (no unhandled error)', async () => {
    const { gm } = fakeGoogle()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const map = await track(openMap(el(), { googleApiKey: 'k', loadLeaflet: async () => { throw new Error('offline') }, loadGoogle: async () => gm }))
    notifyGoogleAuthFailure()
    await vi.waitFor(() => expect(map.provider).toBe('none'))
    expect(() => map.setMarkers(MARKERS)).not.toThrow()
    err.mockRestore()
  })

  it('a map destroyed before Google rejects the key is not rebuilt', async () => {
    const { gm } = fakeGoogle()
    const loadLeaflet = vi.fn()
    const map = await track(openMap(el(), { googleApiKey: 'k', loadLeaflet, loadGoogle: async () => gm }))
    map.destroy()
    notifyGoogleAuthFailure()
    await new Promise((r) => setTimeout(r, 0))
    expect(loadLeaflet).not.toHaveBeenCalled()
  })
})

describe('Google engine', () => {
  it('draws circle markers, opens the popup node and reports the click', async () => {
    const { gm, calls } = fakeGoogle()
    const engine = createGoogleEngine(gm, el(), {})
    engine.setMarkers(MARKERS)
    expect(calls.markers).toHaveLength(2)
    expect(calls.markers[0].opts).toMatchObject({ position: { lat: 6.45, lng: 3.39 }, title: 'Allen Pharmacy' })
    expect(calls.markers[0].opts.icon).toMatchObject({ fillColor: '#0f766e', strokeColor: '#0f766e' })
    calls.markers[0].handlers.click()
    expect(calls.infoOpen[0].content).toBe(MARKERS[0].popup)
    expect(MARKERS[0].onClick).toHaveBeenCalled()
  })

  it('replacing markers removes the old ones from the map', async () => {
    const { gm, calls } = fakeGoogle()
    const engine = createGoogleEngine(gm, el(), {})
    engine.setMarkers(MARKERS)
    engine.setMarkers([MARKERS[1]])
    expect(calls.markers.slice(0, 2).every((m) => m.map === null)).toBe(true)
    expect(calls.markers[2].map).not.toBeNull()
  })

  it('fits several points within maxZoom, and centres a single point at singleZoom', async () => {
    const { gm, calls } = fakeGoogle()
    const engine = createGoogleEngine(gm, el(), {})
    engine.fitTo(MARKERS, { padding: 40, maxZoom: 16 })
    expect(calls.fitBounds[0]).toMatchObject({ pad: 40 })
    expect(calls.fitBounds[0].points).toHaveLength(2)
    expect(calls.setZoom).toContain(16) // fitBounds zoomed to 18; capped
    engine.fitTo([MARKERS[0]], { singleZoom: 15 })
    expect(calls.setCenter[0]).toEqual(MARKERS[0])
    expect(calls.setZoom).toContain(15)
  })

  it('reports the visible area now and on every idle', async () => {
    const { gm, listeners } = fakeGoogle()
    const engine = createGoogleEngine(gm, el(), {})
    const fn = vi.fn()
    engine.onViewChange(fn)
    expect(fn).toHaveBeenCalledWith({ south: 6.4, west: 3.3, north: 6.6, east: 3.5 }, 11)
    listeners.idle()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cooperative gestures when wheel zoom is off, so the page keeps scrolling past the map', () => {
    const { gm } = fakeGoogle()
    const box = el()
    createGoogleEngine(gm, box, { scrollWheelZoom: false })
    // The Map constructor saw the options; read them back through a fresh engine on a spy.
    const spy = vi.spyOn(gm, 'Map')
    createGoogleEngine(gm, box, { scrollWheelZoom: false })
    expect(spy.mock.calls[0][1].gestureHandling).toBe('cooperative')
  })
})

describe('loadGoogleMaps', () => {
  function fakeWindow() {
    const appended = []
    const win = { document: { createElement: () => ({}), head: { appendChild: (s) => appended.push(s) } } }
    return { win, appended }
  }

  it('injects one script with the key and a callback, and resolves when Google calls back', async () => {
    const { win, appended } = fakeWindow()
    const p = loadGoogleMaps('key with space', { win })
    const again = loadGoogleMaps('key with space', { win })
    expect(appended).toHaveLength(1)
    expect(appended[0].src).toMatch(/^https:\/\/maps\.googleapis\.com\/maps\/api\/js\?key=key%20with%20space&v=weekly&loading=async&callback=/)
    win.google = { maps: { Map: function () {} } }
    win.__careEcosystemGoogleMapsReady()
    await expect(p).resolves.toBe(win.google.maps)
    await expect(again).resolves.toBe(win.google.maps)
  })

  it('rejects when the script fails, and tries again on the next call', async () => {
    const { win, appended } = fakeWindow()
    const p = loadGoogleMaps('k', { win })
    appended[0].onerror()
    await expect(p).rejects.toThrow(/could not be downloaded/)
    loadGoogleMaps('k', { win }).catch(() => {})
    expect(appended).toHaveLength(2)
  })

  it('rejects after the timeout', async () => {
    vi.useFakeTimers()
    const { win } = fakeWindow()
    const p = loadGoogleMaps('k', { win, timeoutMs: 1000 })
    const check = expect(p).rejects.toThrow(/too long/)
    vi.advanceTimersByTime(1001)
    await check
    vi.useRealTimers()
  })

  it('refuses without a key', async () => {
    await expect(loadGoogleMaps('', { win: fakeWindow().win })).rejects.toThrow(/not configured/)
  })

  it('a rejected key reaches the page\'s earlier gm_authFailure handler too', async () => {
    const { win } = fakeWindow()
    const earlier = vi.fn()
    win.gm_authFailure = earlier
    loadGoogleMaps('k', { win }).catch(() => {})
    win.gm_authFailure()
    expect(earlier).toHaveBeenCalled()
  })
})

describe('resolveLeaflet', () => {
  it('accepts the library under default, or the module itself', () => {
    const lib = { map() {}, tileLayer() {} }
    expect(resolveLeaflet({ default: lib })).toBe(lib)
    expect(resolveLeaflet(lib)).toBe(lib)
    expect(resolveLeaflet({ ...lib, default: lib })).toBe(lib)
  })
})
