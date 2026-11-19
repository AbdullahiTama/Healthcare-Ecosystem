import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import ResultsMap, { businessPopup } from '../../../modules/business-discovery/components/ResultsMap.jsx'
import DeliveryTrackingMap, { trackingPopup } from '../../shop/DeliveryTrackingMap.jsx'

// CareFind's two maps against a stand-in map engine (the provider choice, Google or OpenStreetMap, is tested with the
// engine in apps/carehub/src/components/maps/__tests__/mapEngine.test.js). What each map draws, that popups stay
// text, and the loading / failure states.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function fakeEngine() {
  const state = { markers: [], fits: [], destroyed: 0, opts: null }
  const handle = {
    provider: 'google',
    setMarkers: (m) => { state.markers = m },
    fitTo: (points, opts) => { state.fits.push({ points, opts }) },
    onViewChange: () => {},
    destroy: () => { state.destroyed++ },
  }
  return { state, open: vi.fn(async (_el, opts) => { state.opts = opts; return handle }) }
}

let root, host, engine
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function render(ui) {
  await act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>) })
  await flush(); await flush()
}
const XSS = '<img src=x onerror=alert(1)>'

beforeEach(() => {
  engine = fakeEngine()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ResultsMap (business discovery)', () => {
  const BUSINESSES = [
    { id: 'b1', name: 'Medplus', latitude: 6.6, longitude: 3.35, address: '12 Allen Avenue', category: { name: 'Pharmacy' }, phone: '0803' },
    { id: 'b2', name: 'Reddington', latitude: 6.61, longitude: 3.36 },
    { id: 'b3', name: 'No coordinates' },
  ]

  it('draws one marker per business with coordinates, plus the searcher, and fits the businesses', async () => {
    await render(<ResultsMap businesses={BUSINESSES} center={{ lat: 6.5, lng: 3.3 }} open={engine.open} />)
    expect(engine.state.markers.map((m) => m.title)).toEqual(['Medplus', 'Reddington', 'Your location'])
    expect(engine.state.fits[0].points).toEqual([{ lat: 6.6, lng: 3.35 }, { lat: 6.61, lng: 3.36 }])
    expect(engine.state.opts.center).toEqual({ lat: 6.5, lng: 3.3 })
    expect(typeof engine.state.opts.loadLeaflet).toBe('function')
  })

  it('clicking a marker opens the business card with its actions', async () => {
    await render(<ResultsMap businesses={BUSINESSES} open={engine.open} />)
    await act(async () => { engine.state.markers[0].onClick() })
    expect(host.textContent).toContain('View Details')
    expect(host.querySelector('a[href="tel:0803"]')).not.toBeNull()
  })

  it('popups keep names and addresses as text', () => {
    const el = businessPopup({ name: XSS, address: '<b>x</b>', category: { name: 'Pharmacy' } })
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.textContent).toContain(XSS)
  })

  it('does not open the map while results are loading, then opens it', async () => {
    await render(<ResultsMap businesses={[]} isLoading open={engine.open} />)
    expect(engine.open).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Loading map')
    await render(<ResultsMap businesses={BUSINESSES} open={engine.open} />)
    expect(engine.open).toHaveBeenCalledTimes(1)
  })

  it('says so when the map cannot be loaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(<ResultsMap businesses={BUSINESSES} open={async () => { throw new Error('offline') }} />)
    expect(host.textContent).toContain('The map could not be loaded')
    expect(host.textContent).toContain('list view')
    err.mockRestore()
  })
})

describe('DeliveryTrackingMap', () => {
  it('draws the pickup station, delivery address and rider, and fits them', async () => {
    await render(<DeliveryTrackingMap open={engine.open}
      pickupStation={{ lat: 6.5, lng: 3.3, name: 'Ikeja Hub', address: 'Allen' }}
      deliveryAddress={{ lat: 6.55, lng: 3.35, address: '5 Road' }}
      currentLocation={{ lat: 6.52, lng: 3.32 }} />)
    expect(engine.state.markers.map((m) => m.title)).toEqual(['Ikeja Hub', 'Delivery address', 'Current location'])
    expect(engine.state.fits[0].points).toHaveLength(3)
    expect(engine.state.opts).toMatchObject({ scrollWheelZoom: false, zoom: 6 })
  })

  it('skips positions that are missing or 0,0', async () => {
    await render(<DeliveryTrackingMap open={engine.open} currentLocation={{ lat: 0, lng: 0 }} deliveryAddress={{ address: 'no coords' }} />)
    expect(engine.state.markers).toEqual([])
    expect(engine.state.fits).toEqual([])
  })

  it('a station name or address with HTML stays text (the old popup ran it)', () => {
    const el = trackingPopup(XSS, '<b>addr</b>')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.textContent).toContain(XSS)
  })

  it('labels the map and says so when it cannot be loaded', async () => {
    await render(<DeliveryTrackingMap open={engine.open} />)
    expect(host.querySelector('[role="region"]').getAttribute('aria-label')).toBe('Delivery map')
    act(() => root.unmount())
    root = createRoot(host)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(<DeliveryTrackingMap open={async () => { throw new Error('offline') }} />)
    expect(host.textContent).toContain('The map could not be loaded')
    err.mockRestore()
  })
})
