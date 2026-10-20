import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// What a report says it was about. A place near the phone is a suggestion: nothing
// is saved as the place visited until the rep chooses it, a report names at most
// one target, and the feed/table say the same thing the report stored.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    reverseGeocode: vi.fn(), uploadActivityVoice: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}), subscribeChanges: vi.fn(() => () => {}) }))
vi.mock('../checkins/CheckInPanel.jsx', () => ({ default: () => null }))
vi.mock('../checkins/TeamLocations.jsx', () => ({ default: () => null }))
vi.mock('../../lib/places.js', () => ({
  FACILITY_FILTERS: [{ key: 'all', label: 'All' }],
  nearbyHealthFacilities: vi.fn(),
  getRepAddedFacilities: vi.fn(async () => []),
  confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(), addRepAddedFacility: vi.fn(),
}))
// The directory picker has its own tests; here it is a stub with the same contract.
vi.mock('../business-directory/components/NearbyBusinessPicker', () => ({
  default: ({ selected, onSelect }) => (
    <div data-testid='dir-picker'>
      {selected
        ? <button type='button' onClick={() => onSelect(null)}>Clear directory business</button>
        : <button type='button' onClick={() => onSelect({ id: 'dir-1', name: 'Allen Pharmacy' })}>Pick Allen Pharmacy</button>}
    </div>
  ),
}))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { nearbyHealthFacilities } from '../../lib/places.js'
import { liveActivityRepository as repo } from './repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const STAFF = { id: 'staff-1', full_name: 'Ada Rep', role: 'Sales Rep' }
const FIELD = { id: 'fld-1', label: 'Customer', field_type: 'text', required: false, sort_order: 0 }
const GENERAL = { name: 'Lagos General', lat: 6.5001, lng: 3.4001, category: 'Hospital', address: '1 Marina', distanceM: 15, source: 'detected' }
const CLINIC = { name: 'Ikeja Clinic', lat: 6.502, lng: 3.402, category: 'Clinic', address: '', distanceM: 300, source: 'detected' }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async () => { await flush(); await flush(); await flush() }
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
const dialog = () => host.querySelector('[role="dialog"]')

function withGps(coords) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: coords
      ? { getCurrentPosition: (ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 20 } }) }
      : { getCurrentPosition: (ok, fail) => fail({ code: 1 }) },
  })
}

async function openForm() {
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
  await flush()
  await act(async () => { button('Log Activity').click() })
  await settle()
}
const submit = async () => { await act(async () => { button('Log It').click() }); await flush() }
const lastSaved = () => repo.logActivity.mock.calls.at(-1)[0]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  repo.getActivityFields.mockResolvedValue([FIELD])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  repo.reverseGeocode.mockResolvedValue('Allen Avenue, Ikeja')
  nearbyHealthFacilities.mockResolvedValue({ facilities: [GENERAL, CLINIC], fromCache: false })
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  withGps(true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('choosing what the report is about', () => {
  it('lists nearby places as suggestions and chooses NONE of them for the rep', async () => {
    await openForm()
    expect(dialog().textContent).toContain('Possible places near you')
    expect(dialog().textContent).toContain('Lagos General')          // offered
    expect(dialog().textContent).toContain('Choose the one you visited')
    await submit()
    const saved = lastSaved()
    expect(saved.facility_name).toBeNull()
    expect(saved.place_of_visit).toBeNull()
    expect(saved.facility_lat).toBeNull()
    expect(saved.directory_business_id).toBeUndefined()
    expect(saved.lat).toBe(6.5)                                       // the GPS pin is still kept as evidence
  })

  it('saves a place only after the rep taps it, with its source and the GPS distance as evidence', async () => {
    await openForm()
    await act(async () => { button('Lagos General').click() })
    await submit()
    const saved = lastSaved()
    expect(saved).toMatchObject({ facility_name: 'Lagos General', facility_source: 'detected', location_label: 'Lagos General' })
    expect(saved.facility_distance_m).toBeGreaterThanOrEqual(0)
    expect(saved.directory_business_id).toBeUndefined()
  })

  it('choosing a directory business replaces a chosen facility: one target, not two', async () => {
    await openForm()
    await act(async () => { button('Lagos General').click() })
    await act(async () => { button('Clear this choice').click() })
    await act(async () => { button('Pick Allen Pharmacy').click() })
    await submit()
    const saved = lastSaved()
    expect(saved).toMatchObject({ directory_business_id: 'dir-1', directory_business_name: 'Allen Pharmacy' })
    expect(saved.facility_name).toBeNull()
    expect(saved.location_label).toBe('Allen Pharmacy')
  })

  it('while a facility is chosen the directory suggestions step aside, so there is one authority', async () => {
    await openForm()
    expect(host.querySelector('[data-testid="dir-picker"]')).toBeTruthy()
    await act(async () => { button('Lagos General').click() })
    expect(host.querySelector('[data-testid="dir-picker"]')).toBeNull()
    await act(async () => { button('Clear this choice').click() })
    expect(host.querySelector('[data-testid="dir-picker"]')).toBeTruthy()
  })

  it('with a directory business chosen, the map suggestions are not offered', async () => {
    await openForm()
    await act(async () => { button('Pick Allen Pharmacy').click() })
    expect(dialog().textContent).not.toContain('From map data')
    expect(dialog().textContent).not.toContain('Possible places near you')
  })

  it('clearing the choice goes back to nothing chosen', async () => {
    await openForm()
    await act(async () => { button('Lagos General').click() })
    await act(async () => { button('Clear this choice').click() })
    await submit()
    expect(lastSaved().facility_name).toBeNull()
  })

  it('without a location it says so and the report can still be logged, with no invented place or pin', async () => {
    withGps(false)
    await openForm()
    expect(dialog().textContent).toContain('Your location is not available')
    expect(nearbyHealthFacilities).not.toHaveBeenCalled()
    await submit()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    const saved = lastSaved()
    expect(saved.lat).toBeNull()
    expect(saved.lng).toBeNull()
    expect(saved.facility_name).toBeNull()
    expect(saved.location_label).toBeNull()
  })

  it('states that nothing is recorded as visited until a choice is made', async () => {
    await openForm()
    expect(dialog().textContent).toContain('Nothing is recorded as visited until you choose one')
  })
})

describe('how a saved report reads', () => {
  const base = { business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', values_json: '{}', created_at: '2026-10-20T10:00:00Z', place_verified: false, facility_verified: false, facility_pending_review: false }
  const show = async (rows, role = 'Sales Rep') => {
    localStorage.setItem('carehub_auth', JSON.stringify({ staff: { ...STAFF, role }, brand: { id: BRAND.id, owner: 'Boss' } }))
    repo.getFieldActivities.mockResolvedValue(rows)
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} perms={{}} /></MemoryRouter>) })
    await settle()
  }

  it('a report with no place shows no place line and no "not matched" badge', async () => {
    await show([{ ...base, id: 'r1' }])
    expect(host.textContent).toContain('Ada Rep')
    expect(host.textContent).not.toContain('Not matched')
    expect(host.textContent).not.toContain('Location matches')
  })

  it('a facility target shows its source and a location comparison that does not claim a visit', async () => {
    await show([{ ...base, id: 'r2', facility_name: 'Lagos General', facility_category: 'Hospital', facility_source: 'detected', facility_verified: true, place_verified: true, facility_distance_m: 12, lat: 6.5, lng: 3.4 }])
    expect(host.textContent).toContain('Lagos General')
    expect(host.textContent).toContain('Map data')
    expect(host.textContent).toContain('Location matches')
    expect(host.textContent).toContain('12 m from GPS pin')
    expect(host.textContent).not.toContain('GPS verified')
  })

  it('a directory target is shown as a company-directory business', async () => {
    await show([{ ...base, id: 'r3', directory_business_id: 'dir-1', directory_business_name: 'Allen Pharmacy' }])
    expect(host.textContent).toContain('Business: Allen Pharmacy')
    expect(host.textContent).toContain('Company directory')
  })

  it('an area caption is shown as an area, not as the place visited', async () => {
    await show([{ ...base, id: 'r4', location_label: 'Allen Avenue, Ikeja' }])
    expect(host.textContent).toContain('Near Allen Avenue, Ikeja')
  })

  it('the table and the export use the same wording as the card', async () => {
    await show([{ ...base, id: 'r5', location_label: 'Allen Avenue, Ikeja' }, { ...base, id: 'r6', created_at: '2026-10-20T09:00:00Z', facility_name: 'Lagos General', location_label: 'Lagos General' }])
    await act(async () => { button('Table').click() })
    const cells = [...host.querySelectorAll('td')].map((c) => c.textContent)
    expect(cells).toContain('Near Allen Avenue, Ikeja')
    expect(cells).toContain('Lagos General')
  })

  it('a manager\'s read-only comparison is called a comparison, not a verification or approval', async () => {
    await show([{ ...base, id: 'r7', staff_id: 'other', lat: 6.5, lng: 3.4, facility_name: 'Lagos General' }], 'Regional Manager')
    await act(async () => { button('Team Reports').click() })
    await settle()
    expect(button('Compare location')).toBeTruthy()
    expect(host.textContent).not.toContain('Verify location')
    await act(async () => { button('Compare location').click() })
    expect(host.textContent).toContain('Compare logged location')
    expect(host.textContent).toContain('This changes nothing on the report')
  })
})
