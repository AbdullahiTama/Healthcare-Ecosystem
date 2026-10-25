import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// Platform admin > Directory > Map: find businesses of the managed kinds on OpenStreetMap and add one at a time.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const view = vi.hoisted(() => ({ bounds: { south: 6.4, west: 3.3, north: 6.5, east: 3.4 }, zoom: 15, report: null }))
vi.mock('../../../../components/maps/LeafletMap.jsx', async () => {
  const React = await import('react')
  return {
    default: function MockMap({ pins, onPinClick, onViewChange, fit }) {
      view.report = onViewChange
      React.useEffect(() => { onViewChange(view.bounds, view.zoom) }, [])
      return <ul data-testid='map' data-fit={String(fit)}>{pins.map((p) => <li key={p.id}><button type='button' data-pin={p.id} data-tone={p.tone} onClick={() => onPinClick(p)}>{p.title}</button></li>)}</ul>
    },
  }
})

import MapTab from '../MapTab.jsx'

const CATEGORIES = [{ id: 'ph', name: 'Pharmacy', is_active: true }, { id: 'ho', name: 'Hospital', is_active: true }]
const OSM = [
  { ref: 'node/1', name: 'Allen Pharmacy', lat: 6.45, lng: 3.39, tags: { amenity: 'pharmacy' }, address: '12 Allen Avenue, Ikeja', state: 'Lagos', lga: '', city: 'Ikeja', phone: '0801', website: 'javascript:alert(1)', openingHours: 'Mo-Sa 08:00-20:00' },
  { ref: 'way/2', name: 'City Hospital', lat: 6.46, lng: 3.38, tags: { amenity: 'hospital' }, address: '', state: '', lga: '', city: '', phone: '', website: 'https://city.example', openingHours: '' },
  { ref: 'node/3', name: 'Big Supermarket', lat: 6.47, lng: 3.37, tags: { shop: 'supermarket' }, address: '', state: '', lga: '', city: '', phone: '', website: '', openingHours: '' },
]

let root, host, repo, fetchOsm, onAdd
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const pin = (ref) => host.querySelector(`[data-pin="${ref}"]`)
async function show(props = {}) {
  await act(async () => { root.render(<MapTab repo={repo} scopeId='platform' categories={CATEGORIES} onAdd={onAdd} fetchOsm={fetchOsm} {...props} />) })
  await flush()
}
async function search() { await act(async () => { button('Show businesses here').click() }); await flush(); await flush() }

beforeEach(() => {
  view.bounds = { south: 6.4, west: 3.3, north: 6.5, east: 3.4 }; view.zoom = 15
  repo = { searchWithinBox: vi.fn(async () => [{ id: 'd9', name: 'City Hospital', latitude: 6.46, longitude: 3.38, category_id: 'ho', is_active: true, source_detail: 'OpenStreetMap way/2' }]) }
  fetchOsm = vi.fn(async () => OSM)
  onAdd = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Directory map', () => {
  it('starts by explaining what to do, keeps the view where the admin puts it, and credits OpenStreetMap', async () => {
    await show()
    expect(host.textContent).toContain('Move the map to an area and press Show businesses here.')
    expect(host.querySelector('[data-testid="map"]').getAttribute('data-fit')).toBe('false')
    expect(fetchOsm).not.toHaveBeenCalled()
    expect(host.textContent).toMatch(/OpenStreetMap contributors/)
  })

  it('zoomed out, it asks to zoom in and does not search', async () => {
    view.zoom = 10
    await show()
    expect(host.textContent).toContain('Zoom in closer (to a town or neighbourhood) to search.')
    expect(button('Show businesses here').disabled).toBe(true)
  })

  it('searching shows the managed kinds only, marking what is already listed', async () => {
    await show()
    await search()
    expect(fetchOsm).toHaveBeenCalledWith(view.bounds)
    expect(repo.searchWithinBox.mock.calls[0][0]).toBe('platform')
    expect(pin('node/1').getAttribute('data-tone')).toBe('new')
    expect(pin('way/2').getAttribute('data-tone')).toBe('listed')
    expect(pin('node/3')).toBeNull()
    expect(host.textContent).toContain('2 businesses found')
  })

  it('"Hide already listed" and the category filter narrow the map and the list', async () => {
    await show()
    await search()
    await act(async () => { host.querySelector('input[type="checkbox"]').click() })
    expect(pin('way/2')).toBeNull()
    await act(async () => { host.querySelector('input[type="checkbox"]').click() })
    const sel = host.querySelector('select[aria-label="Category"]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'ho'); sel.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(pin('node/1')).toBeNull()
    expect(pin('way/2')).toBeTruthy()
  })

  it('a business shows its details; a non-http website stays text; Add to directory pre-fills the form', async () => {
    await show()
    await search()
    await act(async () => { pin('node/1').click() })
    const details = host.querySelector('[aria-label="Business details"]')
    expect(details.textContent).toContain('12 Allen Avenue, Ikeja')
    expect(details.textContent).toContain('Mo-Sa 08:00-20:00')
    expect(details.textContent).toContain('javascript:alert(1)')
    expect([...details.querySelectorAll('a')].some((a) => a.getAttribute('href') === 'javascript:alert(1)')).toBe(false)
    expect([...details.querySelectorAll('a')].some((a) => a.getAttribute('href') === 'https://www.openstreetmap.org/node/1')).toBe(true)
    await act(async () => { button('Add to directory').click() })
    expect(onAdd).toHaveBeenCalledWith({
      fromMap: 'node/1', name: 'Allen Pharmacy', category_id: 'ph', address: '12 Allen Avenue, Ikeja', state: 'Lagos', lga: '', city: 'Ikeja',
      latitude: 6.45, longitude: 3.39, phone: '0801', website: '', opening_hours: 'Mo-Sa 08:00-20:00',
      data_source: 'external', source_detail: 'OpenStreetMap node/1',
    })
  })

  it('an already listed business cannot be added again', async () => {
    await show()
    await search()
    await act(async () => { pin('way/2').click() })
    expect(host.textContent).toContain('Already in the directory as City Hospital')
    expect(button('Add to directory')).toBeUndefined()
  })

  it('a search cannot be started twice: the button waits while one is running', async () => {
    let release
    fetchOsm.mockImplementationOnce(() => new Promise((r) => { release = () => r(OSM) }))
    await show()
    await act(async () => { button('Show businesses here').click() })
    expect(button('Show businesses here').disabled).toBe(true)
    expect(host.textContent).toContain('Looking for businesses')
    await act(async () => { button('Show businesses here').click() })
    expect(fetchOsm).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
    await flush()
    expect(pin('node/1')).toBeTruthy()
    expect(button('Show businesses here').disabled).toBe(false)
  })

  it('a busy OpenStreetMap says so with a retry', async () => {
    fetchOsm.mockRejectedValueOnce(new Error('OpenStreetMap is busy or unreachable. Try again in a moment.'))
    await show()
    await search()
    expect(host.textContent).toContain('OpenStreetMap is busy or unreachable. Try again in a moment.')
    await act(async () => { button('Try again').click() })
    await flush(); await flush()
    expect(pin('node/1')).toBeTruthy()
  })

  it('nothing of the managed kinds here says so', async () => {
    fetchOsm.mockResolvedValue([OSM[2]])
    await show()
    await search()
    expect(host.textContent).toContain('No businesses of the kinds the directory manages were found here.')
  })

  it('after a save (reloadKey) the listings are checked again, so the added business shows as listed', async () => {
    await show()
    await search()
    repo.searchWithinBox.mockResolvedValue([{ id: 'dnew', name: 'Allen Pharmacy', latitude: 6.45, longitude: 3.39, category_id: 'ph', is_active: true, source_detail: 'OpenStreetMap node/1' }])
    await show({ reloadKey: 1 })
    await flush()
    expect(pin('node/1').getAttribute('data-tone')).toBe('listed')
    expect(fetchOsm).toHaveBeenCalledTimes(1)
  })
})
