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
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}), subscribeChanges: vi.fn(() => () => {}) }))
// The check-in panels have their own tests; here they must not touch the network.
vi.mock('../checkins/CheckInPanel.jsx', () => ({ default: () => null }))
vi.mock('../checkins/TeamLocations.jsx', () => ({ default: () => null }))
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
import { watchTable, subscribeChanges } from '../../lib/realtime'
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

  it('pages older activity on request, keyed by the oldest row, and does not duplicate', async () => {
    const mk = (i) => ({ id: 'a' + i, business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', rep_title: 'Field Rep', values_json: '{}', created_at: new Date(Date.UTC(2026, 9, 19, 12, 0, 0) - i * 60000).toISOString() })
    const first = Array.from({ length: 100 }, (_, i) => mk(i))
    repo.getFieldActivities.mockResolvedValueOnce(first).mockResolvedValueOnce([mk(99), mk(100), mk(101)])
    await act(async () => { root.render(<LiveActivity brand={BRAND} />) })
    await flush()
    expect(button('Load older activity')).toBeTruthy()
    await act(async () => { button('Load older activity').click() })
    await flush()
    expect(repo.getFieldActivities).toHaveBeenLastCalledWith('brand-1', { limit: 100, before: first[99].created_at })
    // Only the genuinely new rows had their viewers/reactions/comments fetched.
    expect(repo.getActivityViewers.mock.calls.at(-1)[0]).toEqual(['a100', 'a101'])
    // A short page means nothing older is left.
    expect(button('Load older activity')).toBeFalsy()
  })

  it('refetches once when the realtime connection comes back after a drop', async () => {
    await act(async () => { root.render(<LiveActivity brand={BRAND} />) })
    await flush()
    const onStatus = watchTable.mock.calls[0][3]
    const loadsBefore = repo.getFieldActivities.mock.calls.length
    await act(async () => { onStatus('live') })           // first connection: nothing missed
    expect(repo.getFieldActivities.mock.calls.length).toBe(loadsBefore)
    await act(async () => { onStatus('disconnected') })
    expect(host.textContent).toContain('NOT LIVE')
    await act(async () => { onStatus('live') })           // back: catch up
    await flush()
    expect(repo.getFieldActivities.mock.calls.length).toBe(loadsBefore + 1)
    expect(host.textContent).toContain('LIVE')
    expect(host.textContent).not.toContain('NOT LIVE')
  })

  it('refreshes only reactions and comments when they change live, debounced', async () => {
    vi.useFakeTimers()
    try {
      repo.getFieldActivities.mockResolvedValue([{ id: 'a1', business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', values_json: '{}', created_at: '2026-10-19T10:00:00Z' }])
      await act(async () => { root.render(<LiveActivity brand={BRAND} />) })
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      const reactionsCall = subscribeChanges.mock.calls.find((c) => c[0].table === 'activity_reactions')
      expect(reactionsCall[0].event).toBe('*')
      const notify = reactionsCall[1]
      repo.getActivityReactions.mockClear(); repo.getActivityComments.mockClear()
      const feedLoads = repo.getFieldActivities.mock.calls.length
      await act(async () => { notify(); notify(); notify(); await vi.advanceTimersByTimeAsync(700) })
      expect(repo.getActivityReactions).toHaveBeenCalledTimes(1)
      expect(repo.getActivityComments).toHaveBeenCalledTimes(1)
      expect(repo.getActivityReactions.mock.calls[0][0]).toEqual(['a1'])
      expect(repo.getFieldActivities.mock.calls.length).toBe(feedLoads) // the feed itself is not refetched
    } finally { vi.useRealTimers() }
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
