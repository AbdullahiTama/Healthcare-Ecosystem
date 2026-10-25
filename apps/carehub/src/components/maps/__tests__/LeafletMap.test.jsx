import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// The shared map wrapper, against a stand-in Leaflet: what the wrapper asks Leaflet to do, and what it reports back.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => {
  const state = { markers: [], mapHandlers: {}, fitBounds: null, setView: null }
  const lib = {
    map: () => {
      const m = {
        on: (ev, fn) => { state.mapHandlers[ev] = fn; return m },
        getBounds: () => ({ getSouth: () => 6.4, getWest: () => 3.3, getNorth: () => 6.6, getEast: () => 3.5 }),
        getZoom: () => 14,
        setView: (...a) => { state.setView(...a); return m },
        fitBounds: (...a) => { state.fitBounds(...a); return m },
        remove: () => {},
      }
      return m
    },
    tileLayer: () => ({ addTo: () => {} }),
    layerGroup: () => ({ addTo() { return this }, clearLayers: () => { state.markers = [] } }),
    circleMarker: (latlng, opts) => {
      const mk = { latlng, opts, handlers: {} }
      mk.bindPopup = () => mk
      mk.on = (ev, fn) => { mk.handlers[ev] = fn; return mk }
      mk.addTo = () => { state.markers.push(mk); return mk }
      return mk
    },
  }
  return { state, lib }
})
vi.mock('leaflet', () => ({ default: fake.lib, ...fake.lib }))
vi.mock('leaflet/dist/leaflet.css', () => ({}))

import LeafletMap from '../LeafletMap.jsx'

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const PINS = [
  { id: 'a', kind: 'business', tone: 'new', lat: 6.45, lng: 3.39, title: 'Allen Pharmacy', lines: [] },
  { id: 'b', kind: 'business', tone: 'listed', lat: 6.46, lng: 3.4, title: 'Mercy Clinic', lines: [] },
]
async function show(props) {
  await act(async () => { root.render(<LeafletMap pins={PINS} {...props} />) })
  await flush(); await flush()
}

beforeEach(() => {
  fake.state.markers = []; fake.state.mapHandlers = {}
  fake.state.fitBounds = vi.fn(); fake.state.setView = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('LeafletMap', () => {
  it('clicking a marker reports that pin', async () => {
    const onPinClick = vi.fn()
    await show({ onPinClick })
    expect(fake.state.markers).toHaveLength(2)
    fake.state.markers[1].handlers.click()
    expect(onPinClick).toHaveBeenCalledWith(PINS[1])
  })

  it('reports the visible area and zoom when ready and after each move', async () => {
    const onViewChange = vi.fn()
    await show({ onViewChange })
    expect(onViewChange).toHaveBeenCalledWith({ south: 6.4, west: 3.3, north: 6.6, east: 3.5 }, 14)
    fake.state.mapHandlers.moveend()
    expect(onViewChange).toHaveBeenCalledTimes(2)
  })

  it('fits the pins by default, and leaves the view alone when fit is off (the admin is choosing the area)', async () => {
    await show({})
    expect(fake.state.fitBounds).toHaveBeenCalled()
    act(() => root.unmount())
    root = createRoot(host)
    fake.state.fitBounds = vi.fn()
    await show({ fit: false })
    expect(fake.state.fitBounds).not.toHaveBeenCalled()
  })

  it('colours the directory tones', async () => {
    await show({})
    expect(fake.state.markers[0].opts.color).toBe('#0f766e')
    expect(fake.state.markers[1].opts.color).toBe('#6b7280')
  })
})
