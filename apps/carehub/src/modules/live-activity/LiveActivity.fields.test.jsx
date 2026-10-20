import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// A new business has no report fields and only its owner can define them. A rep's
// first report must still be possible, and must read back under the same label.

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
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const dialog = () => host.querySelector('[role="dialog"]')
const toast = () => (host.querySelector('[role="status"]') || {}).textContent || ''
const typeInto = async (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function mount({ owner = false, fields = [], rows = [] } = {}) {
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: owner ? undefined : STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  repo.getActivityFields.mockResolvedValue(fields)
  repo.getFieldActivities.mockResolvedValue(rows)
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: undefined })
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('a business with no report fields yet', () => {
  it('lets a rep log a first report instead of stopping them with a warning', async () => {
    await mount()
    await act(async () => { button('Log Activity').click() })
    expect(dialog()).toBeTruthy()
    expect(toast()).not.toContain('No activity fields')
    expect(dialog().textContent).toContain('What happened')
    expect(dialog().textContent).toContain('has not set up its own report fields yet')
    expect(dialog().textContent).toContain('The owner can add fields')
  })

  it('the starter note is required, and a blank one does not save', async () => {
    await mount()
    await act(async () => { button('Log Activity').click() })
    await typeInto(dialog().querySelector('textarea'), '   ')
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Please fill in: What happened')
  })

  it('saves the note under a fixed key and the feed reads it back under the same label', async () => {
    await mount()
    await act(async () => { button('Log Activity').click() })
    await typeInto(dialog().querySelector('textarea'), 'Restocked the shelf and met the pharmacist')
    await act(async () => { button('Log It').click() })
    await flush()
    const saved = repo.logActivity.mock.calls[0][0]
    expect(JSON.parse(saved.values_json)).toEqual({ 'default-summary': 'Restocked the shelf and met the pharmacist' })
  })

  it('shows an earlier note under "What happened" even after the owner defines real fields', async () => {
    const row = { id: 'r1', business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', created_at: '2026-10-20T10:00:00Z', values_json: JSON.stringify({ 'default-summary': 'an older note', f1: 'Allen' }) }
    await mount({ fields: [{ id: 'f1', label: 'Customer', field_type: 'text', required: false, sort_order: 0 }], rows: [row] })
    expect(host.textContent).toContain('What happened')
    expect(host.textContent).toContain('an older note')
    expect(host.textContent).toContain('Customer')
  })

  it('tells the owner, informationally, and not the staff', async () => {
    await mount({ owner: true })
    expect(host.textContent).toContain('Reports use a simple note for now')
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await mount()
    expect(host.textContent).not.toContain('Reports use a simple note for now')
  })
})

describe('a business that has defined its fields', () => {
  const fields = [{ id: 'f1', label: 'Customer', field_type: 'text', required: true, sort_order: 0 }]

  it('uses only its own fields: no starter note, no notice', async () => {
    await mount({ owner: true, fields })
    expect(host.textContent).not.toContain('Reports use a simple note for now')
    await act(async () => { button('Log Activity').click() })
    expect(dialog().textContent).toContain('Customer')
    expect(dialog().textContent).not.toContain('What happened')
    expect(dialog().textContent).not.toContain('has not set up its own report fields')
  })

  it('still enforces its own required fields', async () => {
    await mount({ fields })
    await act(async () => { button('Log Activity').click() })
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Please fill in: Customer')
  })
})
