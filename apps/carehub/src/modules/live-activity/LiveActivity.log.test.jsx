import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// Regression: tapping "Log It" in the Log Activity modal called a bare
// `logActivity({...})` that was never defined, so every attempt to log a field
// visit failed with "Could not log activity: logActivity is not defined" and
// nothing was saved. The submit must go through liveActivityRepository.logActivity.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Everything that would touch the network, a websocket or the Overpass API is
// replaced; the component, its Modal/Toast/PageHeader and useToast run for real.
vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(),
    getFieldActivities: vi.fn(),
    countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(),
    getActivityReactions: vi.fn(),
    getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(),
    logActivity: vi.fn(),
    reverseGeocode: vi.fn(),
    uploadActivityVoice: vi.fn(),
  },
}))
vi.mock('../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}) }))
vi.mock('../../lib/places.js', () => ({
  FACILITY_FILTERS: [],
  nearbyHealthFacilities: vi.fn(async () => []),
  getRepAddedFacilities: vi.fn(async () => []),
  confirmRepAddedFacility: vi.fn(),
  dismissRepAddedFacility: vi.fn(),
  addRepAddedFacility: vi.fn(),
}))
vi.mock('../../lib/facilityDiscovery.js', () => ({ discoverFacilities: vi.fn(async () => ({ facilities: [] })) }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { liveActivityRepository as repo } from './repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const STAFF = { id: 'staff-1', full_name: 'Ada Rep', role: 'Sales Rep', public_title: 'Field Rep' }
const FIELD = { id: 'fld-1', label: 'Customer', field_type: 'text', required: true, sort_order: 0 }

let root, host

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const dialog = () => host.querySelector('[role="dialog"]')
const toast = () => (host.querySelector('[role="status"]') || {}).textContent || ''

// React tracks controlled inputs through the native value setter, so assigning
// .value directly would not reach onChange.
const typeInto = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  vi.clearAllMocks()
  // The module reads the logged-in rep from localStorage, not from a provider.
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))

  repo.getActivityFields.mockResolvedValue([FIELD])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'act-1' })
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
})

describe('LiveActivity log modal', () => {
  it('saves the visit through liveActivityRepository.logActivity and reports success', async () => {
    await act(async () => { root.render(<LiveActivity brand={BRAND} />) })
    await flush() // let load() resolve so the activity fields are available

    await act(async () => { button('Log Activity').click() })
    expect(dialog()).toBeTruthy()

    await typeInto(dialog().querySelector('input[type="text"]'), 'Allen Avenue Pharmacy')
    await act(async () => { button('Log It').click() })
    await flush()

    // Checked first so a regression reports the real error text from the toast.
    expect(toast()).not.toContain('Could not log activity')
    expect(host.textContent).not.toContain('logActivity is not defined')

    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    const [activity, viewers] = repo.logActivity.mock.calls[0]
    expect(activity).toMatchObject({
      business_id: 'brand-1',
      staff_id: 'staff-1',
      rep_name: 'Ada Rep',
      rep_title: 'Field Rep',
      values_json: JSON.stringify({ 'fld-1': 'Allen Avenue Pharmacy' }),
    })
    expect(viewers).toEqual([])

    expect(toast()).toContain('Activity logged')
    expect(dialog()).toBeNull()
  })

  it('does not call the repository while a required field is empty', async () => {
    await act(async () => { root.render(<LiveActivity brand={BRAND} />) })
    await flush()

    await act(async () => { button('Log Activity').click() })
    await act(async () => { button('Log It').click() })
    await flush()

    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(toast()).toContain('Please fill in: Customer')
    expect(dialog()).toBeTruthy()
  })
})
