import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Location trouble must be understood and recoverable, never a dead end and never
// papered over: a refused permission, a timeout, an unsupported browser, a poor fix
// and a failed area-name lookup are different situations, and in every one of them
// the report can still be logged. No position or place name is ever made up.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    lookupArea: vi.fn(), uploadActivityVoice: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}), subscribeChanges: vi.fn(() => () => {}) }))
vi.mock('../checkins/CheckInPanel.jsx', () => ({ default: () => null }))
vi.mock('../checkins/TeamLocations.jsx', () => ({ default: () => null }))
vi.mock('../../lib/places.js', () => ({
  FACILITY_FILTERS: [], nearbyHealthFacilities: vi.fn(async () => ({ facilities: [], fromCache: false })),
  getRepAddedFacilities: vi.fn(async () => []), confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(), addRepAddedFacility: vi.fn(),
}))
vi.mock('../business-directory/components/NearbyBusinessPicker', () => ({ default: () => null }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { liveActivityRepository as repo } from './repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const STAFF = { id: 'staff-1', full_name: 'Ada Rep', role: 'Sales Rep' }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async () => { await flush(); await flush(); await flush() }
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const dialog = () => host.querySelector('[role="dialog"]')
const pos = (accuracy = 20, lat = 6.5, lng = 3.4) => ({ coords: { latitude: lat, longitude: lng, accuracy } })
const typeNote = async (text) => {
  const el = dialog().querySelector('textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { setter.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

// A geolocation whose behaviour each test scripts, call by call.
function geo(...behaviours) {
  const calls = []
  const getCurrentPosition = vi.fn((ok, fail, options) => {
    const b = behaviours[Math.min(calls.length, behaviours.length - 1)]
    calls.push({ ok, fail, options })
    if (b === 'pending') return
    if (b.error) fail({ code: b.error })
    else ok(b)
  })
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  return { getCurrentPosition, calls }
}

async function open() {
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
  await flush()
  await act(async () => { button('Log Activity').click() })
  await settle()
}
const submit = async () => { await act(async () => { button('Log It').click() }); await flush() }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  repo.lookupArea.mockResolvedValue({ status: 'ok', label: 'Allen Avenue, Ikeja' })
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('when the position cannot be captured', () => {
  const cases = [
    ['denied', { error: 1 }, 'Location permission was denied'],
    ['unavailable', { error: 2 }, 'could not be determined'],
    ['timed out', { error: 3 }, 'took too long'],
  ]
  for (const [name, behaviour, text] of cases) {
    it(`${name}: says so in its own words, offers Try again, and the report still saves with no pin`, async () => {
      geo(behaviour)
      await open()
      expect(dialog().textContent).toContain(text)
      expect(button('Try again')).toBeTruthy()
      await typeNote('Visited the pharmacy')
      await submit()
      const saved = repo.logActivity.mock.calls[0][0]
      expect(saved.lat).toBeNull()
      expect(saved.lng).toBeNull()
      expect(saved.location_label).toBeNull()
      expect(repo.lookupArea).not.toHaveBeenCalled()
    })
  }

  it('an unsupported browser says so and does not offer a retry that cannot work', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: undefined })
    await open()
    expect(dialog().textContent).toContain('cannot share a location')
    expect(button('Try again')).toBeUndefined()
  })

  it('Try again captures once more and recovers', async () => {
    const g = geo({ error: 3 }, pos(15))
    await open()
    expect(dialog().textContent).toContain('took too long')
    await act(async () => { button('Try again').click() })
    await settle()
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(dialog().textContent).toContain('accurate to about 15 m')
    expect(dialog().textContent).not.toContain('took too long')
    expect(button('Try again')).toBeUndefined()
  })
})

describe('when a position is captured', () => {
  it('asks the device for a fresh fix, once, not a cached one', async () => {
    const g = geo(pos(20))
    await open()
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(g.calls[0].options).toMatchObject({ maximumAge: 0, enableHighAccuracy: true })
  })

  it('a good fix says how accurate it is and raises no warning', async () => {
    geo(pos(20))
    await open()
    expect(dialog().textContent).toContain('Position captured, accurate to about 20 m')
    expect(dialog().textContent).not.toContain('accuracy is poor')
  })

  it('a poor fix warns that suggestions may be wrong, and the pin is still kept as evidence', async () => {
    geo(pos(850))
    await open()
    expect(dialog().textContent).toContain('accuracy is poor')
    expect(button('Try again')).toBeTruthy()
    await typeNote('Visited')
    await submit()
    expect(repo.logActivity.mock.calls[0][0].lat).toBe(6.5)
  })

  it('a late answer from an earlier open cannot overwrite the current one', async () => {
    const g = geo('pending', 'pending')
    await open()                                             // first open, still waiting
    await act(async () => { button('Cancel').click() })
    await act(async () => { button('Log Activity').click() }) // second open
    await settle()
    expect(g.calls).toHaveLength(2)
    await act(async () => { g.calls[1].ok(pos(20, 6.6, 3.5)) })
    await settle()
    await act(async () => { g.calls[0].ok(pos(700, 9.9, 9.9)) }) // the stale one arrives last
    await settle()
    expect(dialog().textContent).toContain('about 20 m')
    expect(dialog().textContent).not.toContain('about 700 m')
    expect(repo.lookupArea).toHaveBeenCalledTimes(1)
    expect(repo.lookupArea).toHaveBeenCalledWith(6.6, 3.5)
  })
})

describe('telling the person how their position is used', () => {
  it('the report form says the position is taken once, when it opens, and offers the details', async () => {
    geo(pos(20))
    await open()
    expect(dialog().textContent).toContain('captured once, when you open this form')
    expect(dialog().querySelector('button[aria-expanded="false"]')).toBeTruthy()
  })

  it('the notice appears even when the position cannot be captured', async () => {
    geo({ error: 1 })
    await open()
    expect(dialog().textContent).toContain('captured once, when you open this form')
  })
})

describe('the area name', () => {
  it('is shown as the area, with OpenStreetMap credited and linked', async () => {
    geo(pos(20))
    await open()
    expect(dialog().textContent).toContain('Area: Allen Avenue, Ikeja')
    const link = [...dialog().querySelectorAll('a')].find((a) => a.textContent.includes('OpenStreetMap'))
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toContain('openstreetmap.org/copyright')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('"no name here" and "the lookup failed" read differently, and neither stops the report', async () => {
    geo(pos(20))
    repo.lookupArea.mockResolvedValue({ status: 'no_result' })
    await open()
    expect(dialog().textContent).toContain('No area name was found')
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)

    repo.lookupArea.mockRejectedValue(new Error('service down'))
    await open()
    expect(dialog().textContent).toContain('could not be looked up right now')
    expect(dialog().textContent).not.toContain('No area name was found')
    await typeNote('Visited')
    await submit()
    const saved = repo.logActivity.mock.calls[0][0]
    expect(saved.lat).toBe(6.5)           // the pin is still there
    expect(saved.location_label).toBeNull() // and no name was invented
  })

  it('a saved area caption is credited wherever reports are listed', async () => {
    geo(pos(20))
    repo.getFieldActivities.mockResolvedValue([{ id: 'r1', business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', created_at: '2026-10-20T10:00:00Z', values_json: '{}', location_label: 'Allen Avenue, Ikeja' }])
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await settle()
    expect(host.textContent).toContain('Near Allen Avenue, Ikeja')
    expect(host.textContent).toContain('Area names ("Near ...") come from')
    expect(host.textContent).toContain('OpenStreetMap contributors')
  })
})
