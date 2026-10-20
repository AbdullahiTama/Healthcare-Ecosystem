import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Saving a report must be safe to repeat: a double tap or a retry after a failure
// can never leave two reports, the person is told which state the save is in, and
// a failed notification is reported and retryable rather than swallowed.

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
  FACILITY_FILTERS: [], nearbyHealthFacilities: vi.fn(async () => []), getRepAddedFacilities: vi.fn(async () => []),
  confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(), addRepAddedFacility: vi.fn(),
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
const typeInto = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const field = () => dialog().querySelector('input[type="text"]')

async function openAndFill(text = 'Allen Avenue Pharmacy') {
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
  await flush()
  await act(async () => { button('Log Activity').click() })
  await typeInto(field(), text)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  repo.getActivityFields.mockResolvedValue([FIELD])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([{ viewer_staff_id: 'm1', viewer_name: 'Mo Manager' }])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'sent' })
  repo.notifyViewers.mockResolvedValue('sent')
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('saving a report', () => {
  it('two rapid taps on Log It save one report', async () => {
    let release
    repo.logActivity.mockImplementation(() => new Promise((r) => { release = () => r({ id: 'x', notification: 'sent' }) }))
    await openAndFill()
    const b = button('Log It')
    await act(async () => { b.click(); b.click() }) // both before React can re-render
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    expect(button('Saving...').disabled).toBe(true)
    await act(async () => { release() })
    await flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
  })

  it('a failed save keeps the form and retries under the SAME id, never as a second report', async () => {
    repo.logActivity.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ id: 'x', notification: 'sent' })
    await openAndFill()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(dialog()).toBeTruthy()                       // entries are not lost
    expect(field().value).toBe('Allen Avenue Pharmacy')
    expect(host.textContent).toContain('may already be saved')
    expect(button('Retry')).toBeTruthy()

    await act(async () => { button('Retry').click() })
    await flush()
    const [first, second] = repo.logActivity.mock.calls
    expect(first[0].id).toBeTruthy()
    expect(second[0].id).toBe(first[0].id)
    expect(dialog()).toBeNull()
  })

  it('a retry resends exactly what was submitted, even if the form was edited in between', async () => {
    repo.logActivity.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'x', notification: 'sent' })
    await openAndFill('Original text')
    await act(async () => { button('Log It').click() })
    await flush()
    await typeInto(field(), 'Edited after failure')
    await act(async () => { button('Retry').click() })
    await flush()
    const sent = repo.logActivity.mock.calls.map((c) => JSON.parse(c[0].values_json)['fld-1'])
    expect(sent).toEqual(['Original text', 'Original text'])
  })

  it('opening the form again starts a fresh report with a new id', async () => {
    repo.logActivity.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'x', notification: 'sent' })
    await openAndFill('First')
    await act(async () => { button('Log It').click() })
    await flush()
    await act(async () => { button('Cancel').click() })
    await act(async () => { button('Log Activity').click() })
    await typeInto(field(), 'Second')
    await act(async () => { button('Log It').click() })
    await flush()
    const [a, b] = repo.logActivity.mock.calls
    expect(b[0].id).not.toBe(a[0].id)
    expect(JSON.parse(b[0].values_json)['fld-1']).toBe('Second')
  })

  it('whitespace does not satisfy a required field', async () => {
    await openAndFill('   ')
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Please fill in: Customer')
  })
})

describe('notification outcome', () => {
  it('saved but not notified: says so, keeps a retry, and clears it once it works', async () => {
    repo.logActivity.mockResolvedValue({ id: 'x', notification: 'failed' })
    await openAndFill()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(dialog()).toBeNull()                         // the report IS saved
    expect(host.textContent).toContain('saved, but nobody has been notified yet')
    expect(repo.logActivity).toHaveBeenCalledTimes(1)

    await act(async () => { button('Retry notifying').click() })
    await flush()
    expect(repo.notifyViewers).toHaveBeenCalledTimes(1)
    expect(repo.logActivity).toHaveBeenCalledTimes(1)   // retrying never re-saves the report
    expect(host.textContent).not.toContain('nobody has been notified yet')
  })

  it('keeps the notice when notifying fails again', async () => {
    repo.logActivity.mockResolvedValue({ id: 'x', notification: 'failed' })
    repo.notifyViewers.mockResolvedValue('failed')
    await openAndFill()
    await act(async () => { button('Log It').click() })
    await flush()
    await act(async () => { button('Retry notifying').click() })
    await flush()
    expect(host.textContent).toContain('nobody has been notified yet')
  })

  it('refused by the database: no retry is offered, because it cannot work, and what is true is said', async () => {
    repo.logActivity.mockResolvedValue({ id: 'x', notification: 'refused' })
    await openAndFill()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(dialog()).toBeNull()                           // saved
    expect(button('Retry notifying')).toBeUndefined()
    expect(host.textContent).not.toContain('nobody has been notified yet')
    expect(host.textContent).toContain('Shared with me')
    expect(host.textContent).toContain('not available yet')
    expect(repo.notifyViewers).not.toHaveBeenCalled()
  })

  it('a retry that turns out to be refused clears the notice instead of leaving a button that cannot work', async () => {
    repo.logActivity.mockResolvedValue({ id: 'x', notification: 'failed' })
    repo.notifyViewers.mockResolvedValue('refused')
    await openAndFill()
    await act(async () => { button('Log It').click() })
    await flush()
    await act(async () => { button('Retry notifying').click() })
    await flush()
    expect(button('Retry notifying')).toBeUndefined()
    expect(host.textContent).not.toContain('nobody has been notified yet')
    expect(host.textContent).toContain('cannot be retried')
  })

  it('a clean save shows no notice', async () => {
    await openAndFill()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(host.textContent).not.toContain('nobody has been notified')
    expect(toast()).toContain('Activity logged')
  })
})
