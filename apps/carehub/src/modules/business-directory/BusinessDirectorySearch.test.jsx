import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import BusinessDirectorySearch from './BusinessDirectorySearch.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ROWS = [
  { id: 'a', name: 'Alpha Pharmacy', category_id: 'c1', address: '12 Allen Ave', city: 'Ikeja', state: 'Lagos', latitude: 6.6, longitude: 3.35, phone: '08031234567', verification_status: 'verified', verified_at: '2026-09-01T00:00:00Z', data_source: 'manual', distance_m: 1200 },
  { id: 'b', name: 'Beta Clinic', category_id: 'c1', city: 'Yaba', state: 'Lagos', latitude: null, longitude: null, verification_status: 'unverified', data_source: 'import', distance_m: null },
]

// Only read methods exist. If Discovery ever tried to write, it would throw.
function fakeRepo(over = {}) {
  return {
    listCategories: vi.fn().mockResolvedValue([{ id: 'c1', slug: 'pharmacy', name: 'Pharmacies', parent_id: null }]),
    discover: vi.fn().mockResolvedValue({ rows: ROWS, total: 2, hasMore: false }),
    ...over,
  }
}

let host, root
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)) }) }
const text = () => host.textContent
const btn = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label))
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const mount = async (repo, perms) => { await act(async () => { root.render(<BusinessDirectorySearch repo={repo} perms={perms} />) }); await settle() }

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('BusinessDirectorySearch', () => {
  it('starts without searching or asking for location', async () => {
    const repo = fakeRepo()
    const geo = vi.fn(); Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: geo }, configurable: true })
    await mount(repo)
    expect(repo.discover).not.toHaveBeenCalled()
    expect(geo).not.toHaveBeenCalled()
    expect(text()).toContain('Search the directory')
  })

  it('searches, shows explicit verification and the straight-line basis, and hides directions without coordinates', async () => {
    const repo = fakeRepo()
    await mount(repo)
    await click(btn('Search'))
    await settle()
    expect(repo.discover).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Alpha Pharmacy')
    expect(text()).toContain('Verified')
    expect(text()).toContain('Not verified')
    expect(text()).toContain('1.2 km straight-line')
    expect(text()).toContain('No coordinates: not shown on the map')

    // expand the business with coordinates: a directions link to those exact coordinates
    await click(host.querySelector('li button'))
    const dir = [...host.querySelectorAll('a')].find((a) => a.textContent.includes('Directions'))
    expect(dir.getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=6.6%2C3.35')
    expect(dir.getAttribute('rel')).toContain('noopener')

    // and the one without: no directions, an honest message
    await click(host.querySelectorAll('li button')[1])
    expect(text()).toContain('No coordinates, so no directions.')
  })

  it('shows the empty state without inventing results', async () => {
    await mount(fakeRepo({ discover: vi.fn().mockResolvedValue({ rows: [], total: 0, hasMore: false }) }))
    await click(btn('Search')); await settle()
    expect(text()).toContain('No businesses found')
    expect(text()).toContain('never invented')
  })

  it('shows an error with a retry when the search fails', async () => {
    await mount(fakeRepo({ discover: vi.fn().mockRejectedValue(new Error('network down')) }))
    await click(btn('Search')); await settle()
    expect(text()).toContain('network down')
  })

  it('reports a denied location clearly and still lets the user search', async () => {
    const repo = fakeRepo()
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_, bad) => bad({ code: 1 }) }, configurable: true })
    await mount(repo)
    await click(btn('Use my location')); await settle()
    expect(text()).toContain('Location permission was denied')
    await click(btn('Search')); await settle()
    expect(repo.discover.mock.calls[0][0]).toMatchObject({ p_lat: null, p_lng: null, p_radius_m: null })
    expect(text()).toContain('Alpha Pharmacy')
  })

  it('rejects invalid manual coordinates before searching', async () => {
    const repo = fakeRepo()
    await mount(repo)
    const inputs = host.querySelectorAll('input')
    const lat = [...inputs].find((i) => i.id === 'latitude'), lng = [...inputs].find((i) => i.id === 'longitude')
    const setVal = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
    await setVal(lat, '95'); await setVal(lng, '3')
    await click(btn('Use these coordinates'))
    expect(text()).toContain('Enter a latitude between -90 and 90')
    expect(repo.discover).not.toHaveBeenCalled()
  })

  it('offers export only to roles allowed to export reports', async () => {
    await mount(fakeRepo(), { canExportReports: false })
    expect(btn('Export CSV')).toBeUndefined()
    await act(async () => { root.unmount() }); root = createRoot(host)
    await mount(fakeRepo(), { canExportReports: true })
    expect(btn('Export CSV')).toBeTruthy()
  })

  it('degrades to the list when Google Maps is not configured', async () => {
    await mount(fakeRepo())
    expect(text()).toContain('The map is not set up for this workspace yet')
  })
})
