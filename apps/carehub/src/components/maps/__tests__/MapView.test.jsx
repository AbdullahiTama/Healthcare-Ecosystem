import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import MapView from '../MapView.jsx'

// CareHub's map component against a stand-in map engine: what it asks the engine to draw, and what it reports back.
// The provider choice (Google or OpenStreetMap) is the engine's job and is tested in mapEngine.test.js.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function fakeEngine() {
  const state = { markers: [], fits: [], view: null, destroyed: 0, openedWith: null }
  const handle = {
    provider: 'google',
    setMarkers: (m) => { state.markers = m },
    fitTo: (points, opts) => { state.fits.push({ points, opts }) },
    onViewChange: (fn) => { state.view = fn; fn({ south: 6.4, west: 3.3, north: 6.6, east: 3.5 }, 14) },
    destroy: () => { state.destroyed++ },
  }
  const open = vi.fn(async (el, opts) => { state.openedWith = { el, opts }; return handle })
  return { state, open }
}

let root, host, engine
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const PINS = [
  { id: 'a', kind: 'business', tone: 'new', lat: 6.45, lng: 3.39, title: 'Allen Pharmacy', lines: [] },
  { id: 'b', kind: 'business', tone: 'listed', lat: 6.46, lng: 3.4, title: 'Mercy Clinic', lines: [] },
]
async function show(props) {
  await act(async () => { root.render(<MapView pins={PINS} open={engine.open} {...props} />) })
  await flush(); await flush()
}

beforeEach(() => {
  engine = fakeEngine()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('MapView', () => {
  it('opens the map with a Leaflet loader for the fallback', async () => {
    await show({})
    expect(typeof engine.state.openedWith.opts.loadLeaflet).toBe('function')
    expect(engine.state.openedWith.opts).toHaveProperty('googleApiKey')
  })

  it('clicking a marker reports that pin', async () => {
    const onPinClick = vi.fn()
    await show({ onPinClick })
    expect(engine.state.markers).toHaveLength(2)
    engine.state.markers[1].onClick()
    expect(onPinClick).toHaveBeenCalledWith(PINS[1])
  })

  it('reports the visible area and zoom', async () => {
    const onViewChange = vi.fn()
    await show({ onViewChange })
    expect(onViewChange).toHaveBeenCalledWith({ south: 6.4, west: 3.3, north: 6.6, east: 3.5 }, 14)
  })

  it('fits the pins by default, and leaves the view alone when fit is off (the admin is choosing the area)', async () => {
    await show({})
    expect(engine.state.fits).toHaveLength(1)
    expect(engine.state.fits[0].points).toEqual([{ lat: 6.45, lng: 3.39 }, { lat: 6.46, lng: 3.4 }])
    act(() => root.unmount())
    root = createRoot(host)
    engine = fakeEngine()
    await show({ fit: false })
    expect(engine.state.fits).toHaveLength(0)
  })

  it('colours the directory tones and gives every marker a text-only popup', async () => {
    await show({})
    expect(engine.state.markers[0].color).toBe('#0f766e')
    expect(engine.state.markers[1].color).toBe('#6b7280')
    expect(engine.state.markers[0].popup.querySelector('strong').textContent).toBe('Allen Pharmacy')
  })

  it('names the map for screen readers and destroys it on unmount', async () => {
    await show({ label: 'Team map' })
    expect(host.querySelector('[role="region"]').getAttribute('aria-label')).toBe('Team map')
    act(() => root.unmount())
    expect(engine.state.destroyed).toBe(1)
    root = createRoot(host)
  })

  it('says so when the map cannot be loaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await show({ open: async () => { throw new Error('no network') } })
    expect(host.textContent).toContain('The map could not be loaded')
    err.mockRestore()
  })
})
