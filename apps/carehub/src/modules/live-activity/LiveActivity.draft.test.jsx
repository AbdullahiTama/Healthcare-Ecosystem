import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { draftKey } from './draftStore'

// Unsent report text survives a reload or an accidental close. The one rule that
// matters: once a send has been attempted the report may already exist, so nothing
// is kept, or restoring it would log the same visit twice.

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
const ADA = { id: 'staff-1', full_name: 'Ada Rep', role: 'Sales Rep' }
const BOLA = { id: 'staff-2', full_name: 'Bola Rep', role: 'Sales Rep' }
const NOTE = 'default-summary' // the starter field (no custom fields in these tests)

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const dialog = () => host.querySelector('[role="dialog"]')
const note = () => dialog().querySelector('textarea')
const stored = (staff = ADA) => JSON.parse(localStorage.getItem(draftKey(BRAND.id, staff.id)) || 'null')
const typeNote = async (text) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { setter.call(note(), text); note().dispatchEvent(new Event('input', { bubbles: true })) })
}

async function mount(staff = ADA) {
  localStorage.setItem('carehub_auth', JSON.stringify({ staff, brand: { id: BRAND.id, owner: 'Boss' } }))
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
  await flush()
}
const openForm = async () => { await act(async () => { button('Log Activity').click() }); await flush() }
const remount = async (staff = ADA) => {
  act(() => root.unmount()); host.remove()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await mount(staff)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: undefined })
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  territoryRepository.getAll.mockResolvedValue([{ id: 't1', name: 'Ikeja' }])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { vi.restoreAllMocks(); act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('remembering an unsent report', () => {
  it('keeps what was typed, a moment after typing, and not before', async () => {
    await mount(); await openForm()
    await typeNote('Met the pharmacist at the counter')
    expect(stored()).toBeNull()                    // not on every keystroke
    await wait(450)
    expect(stored().values[NOTE]).toBe('Met the pharmacist at the counter')
  })

  it('brings it back after an accidental close, saying so, with the text intact', async () => {
    await mount(); await openForm()
    await typeNote('Half written visit note')
    await wait(450)
    await act(async () => { button('Cancel').click() })
    await openForm()
    expect(note().value).toBe('Half written visit note')
    expect(dialog().textContent).toContain('Restored your unsent draft')
    expect(dialog().textContent).toContain('Your location and place are captured fresh')
  })

  it('and after a full reload', async () => {
    await mount(); await openForm()
    await typeNote('Typed before the page reloaded')
    await wait(450)
    await remount(); await openForm()
    expect(note().value).toBe('Typed before the page reloaded')
  })

  it('Discard draft empties the form and the stored copy', async () => {
    await mount(); await openForm()
    await typeNote('Not wanted')
    await wait(450)
    await act(async () => { button('Cancel').click() })
    await openForm()
    await act(async () => { button('Discard draft').click() })
    expect(note().value).toBe('')
    expect(dialog().textContent).not.toContain('Restored your unsent draft')
    await wait(450)
    expect(stored()).toBeNull()
  })

  it('a report that saves leaves no draft behind', async () => {
    await mount(); await openForm()
    await typeNote('A finished report')
    await wait(450)
    expect(stored()).not.toBeNull()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    expect(stored()).toBeNull()
    await openForm()
    expect(note().value).toBe('')
    expect(dialog().textContent).not.toContain('Restored your unsent draft')
  })
})

describe('never logging the same visit twice', () => {
  it('after a send was attempted and failed, nothing is kept to restore later', async () => {
    repo.logActivity.mockRejectedValue(new Error('network down'))
    await mount(); await openForm()
    await typeNote('May already be on the server')
    await wait(450)
    await act(async () => { button('Log It').click() })
    await flush()
    expect(stored()).toBeNull()
    await wait(450)                                   // and the debounce does not put it back
    expect(stored()).toBeNull()
    await act(async () => { button('Cancel').click() })
    await openForm()
    expect(note().value).toBe('')
  })

  it('after a failed send, editing the form again does not put a draft back either', async () => {
    repo.logActivity.mockRejectedValue(new Error('timeout'))
    await mount(); await openForm()
    await typeNote('First attempt')
    await act(async () => { button('Log It').click() })
    await flush()
    await typeNote('Edited after the failure')       // the retry resends the original; the edit is not kept
    await wait(450)
    expect(stored()).toBeNull()
  })

  it('blank text is never stored as a draft', async () => {
    await mount(); await openForm()
    await typeNote('   ')
    await wait(450)
    expect(stored()).toBeNull()
  })
})

describe('whose draft it is, and what it can contain', () => {
  it('another person on the same browser does not get it', async () => {
    await mount(ADA); await openForm()
    await typeNote('Ada private note')
    await wait(450)
    await act(async () => { button('Cancel').click() })
    await remount(BOLA); await openForm()
    expect(note().value).toBe('')
    expect(dialog().textContent).not.toContain('Restored your unsent draft')
  })

  it('drops answers for fields that no longer exist and a territory that was deleted', async () => {
    localStorage.setItem(draftKey(BRAND.id, ADA.id), JSON.stringify({
      values: { 'deleted-field': 'stale', [NOTE]: 'still valid' }, terrId: 'gone', savedAt: Date.now(),
    }))
    await mount(); await openForm()
    expect(note().value).toBe('still valid')
    const terr = dialog().querySelector('select')
    expect(terr.value).toBe('')
  })

  it('a draft that holds only stale answers is not offered at all', async () => {
    localStorage.setItem(draftKey(BRAND.id, ADA.id), JSON.stringify({ values: { 'deleted-field': 'stale' }, terrId: '', savedAt: Date.now() }))
    await mount(); await openForm()
    expect(dialog().textContent).not.toContain('Restored your unsent draft')
  })
})

describe('when the browser will not store anything', () => {
  it('the form works exactly the same', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k) => { if (String(k).startsWith('carehub_activity_draft')) throw new Error('QuotaExceeded') })
    await mount(); await openForm()
    await typeNote('No storage available')
    await wait(450)
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
  })
})
