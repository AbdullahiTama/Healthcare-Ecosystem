import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Proof photos travel with the report: uploaded before it is saved (like the voice note), reused on a retry,
// queued with it when the connection is down, and never the reason a report is lost.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    lookupArea: vi.fn(), uploadActivityVoice: vi.fn(), uploadActivityPhoto: vi.fn(),
    signedVoiceUrl: vi.fn(), signedPhotoUrl: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('./outbox', () => ({
  liveActivityOutbox: {
    enqueue: vi.fn(), list: vi.fn(async () => []), subscribe: vi.fn(() => () => {}),
    flush: vi.fn(), retry: vi.fn(), discard: vi.fn(), start: vi.fn(() => () => {}),
  },
}))
vi.mock('./photoPrep', () => ({
  MAX_PHOTO_INPUT_BYTES: 15 * 1024 * 1024,
  prepareProofPhoto: vi.fn(async (f) => ({ ok: true, blob: new Blob([f.name], { type: 'image/jpeg' }) })),
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
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { liveActivityRepository as repo } from './repositories'
import { liveActivityOutbox as outbox } from './outbox'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const STAFF = { id: 'staff-1', full_name: 'Ada Rep', role: 'Sales Rep' }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async () => { await flush(); await flush() }
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
const dialog = () => host.querySelector('[role="dialog"]')
const fileInput = () => dialog().querySelector('input[type="file"]')

async function typeNote(text) {
  const el = dialog().querySelector('textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { setter.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function openForm() {
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
  await flush()
  await act(async () => { button('Log Activity').click() })
  await settle()
  await typeNote('Visited the pharmacy')
}
async function attach(...names) {
  Object.defineProperty(fileInput(), 'files', { configurable: true, value: names.map((name) => ({ name })) })
  await act(async () => { fileInput().dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}
const submit = async () => { await act(async () => { button('Log It').click() }); await settle() }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: undefined })
  URL.createObjectURL = vi.fn(() => 'blob:thumb')
  URL.revokeObjectURL = vi.fn()
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  let n = 0
  repo.uploadActivityPhoto.mockImplementation(async (_b, { businessId, activityId, index }) => businessId + '/' + activityId + '-' + index + '-p' + (++n) + '.jpg')
  outbox.enqueue.mockImplementation(async (e) => ({ id: e.activity.id }))
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('proof photos on a report', () => {
  it('the form offers to add photos', async () => {
    await openForm()
    expect(button('Add photo')).toBeTruthy()
  })

  it('photos upload BEFORE the report is saved, under its id, and their paths travel with it', async () => {
    await openForm()
    await attach('a.jpg', 'b.jpg')
    await submit()
    expect(repo.uploadActivityPhoto).toHaveBeenCalledTimes(2)
    const saved = repo.logActivity.mock.calls[0][0]
    expect(repo.uploadActivityPhoto.mock.calls.map((c) => c[1])).toEqual([
      { businessId: 'brand-1', activityId: saved.id, index: 0 },
      { businessId: 'brand-1', activityId: saved.id, index: 1 },
    ])
    expect(saved.photo_paths).toHaveLength(2)
    expect(repo.uploadActivityPhoto.mock.invocationCallOrder.at(-1)).toBeLessThan(repo.logActivity.mock.invocationCallOrder[0])
    expect(dialog()).toBeNull()
  })

  it('a report without photos is saved exactly as before: nothing uploaded, no photo_paths', async () => {
    await openForm()
    await submit()
    expect(repo.uploadActivityPhoto).not.toHaveBeenCalled()
    expect(repo.logActivity.mock.calls[0][0]).not.toHaveProperty('photo_paths')
  })

  it('a refused photo (too large) saves nothing, keeps the form, and says why', async () => {
    repo.uploadActivityPhoto.mockRejectedValue(new Error('Photo upload failed (413): too large'))
    await openForm()
    await attach('a.jpg')
    await submit()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(outbox.enqueue).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    expect(host.textContent).toContain('A photo did not upload')
    expect(host.textContent).toContain('Nothing was saved')
  })

  it('with the connection down, the photos are queued WITH the report, and the report is not sent without them', async () => {
    repo.uploadActivityPhoto.mockRejectedValue(new TypeError('Failed to fetch'))
    await openForm()
    await attach('a.jpg', 'b.jpg')
    await submit()
    expect(repo.logActivity).not.toHaveBeenCalled()
    const queued = outbox.enqueue.mock.calls[0][0]
    expect(queued.photoBlobs).toHaveLength(2)
    expect(queued.photoPaths).toEqual([])
    expect(queued.activity).not.toHaveProperty('photo_paths')
    expect(dialog()).toBeNull()
  })

  it('a photo that uploaded before the connection dropped keeps its place; only the rest is queued', async () => {
    repo.uploadActivityPhoto.mockResolvedValueOnce('brand-1/r-0-first.jpg').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await openForm()
    await attach('a.jpg', 'b.jpg')
    await submit()
    const queued = outbox.enqueue.mock.calls[0][0]
    expect(queued.photoPaths).toEqual(['brand-1/r-0-first.jpg'])
    expect(queued.photoBlobs).toHaveLength(1)
  })

  it('a retry after a failed save does not upload the photos again', async () => {
    repo.logActivity.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ id: 'x', notification: 'none' })
    outbox.enqueue.mockRejectedValue(Object.assign(new Error('no storage'), { code: 'unavailable' }))
    await openForm()
    await attach('a.jpg')
    await submit()
    expect(button('Retry')).toBeTruthy()
    await act(async () => { button('Retry').click() }); await settle()
    expect(repo.uploadActivityPhoto).toHaveBeenCalledTimes(1)
    const [first, second] = repo.logActivity.mock.calls
    expect(second[0].photo_paths).toEqual(first[0].photo_paths)
  })

  describe('on a saved report in the feed', () => {
    const base = { business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', values_json: '{}', created_at: '2026-10-20T10:00:00Z', place_verified: false, facility_verified: false, facility_pending_review: false }
    const showFeed = async (rows) => {
      repo.getFieldActivities.mockResolvedValue(rows)
      await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} perms={{}} /></MemoryRouter>) })
      await settle()
      await settle()
    }

    it('shows the report\'s photos through signed links, named for the place', async () => {
      repo.signedPhotoUrl.mockImplementation(async (p) => 'https://signed/' + p)
      await showFeed([{ ...base, id: 'r1', facility_name: 'Lagos General', location_label: 'Lagos General', photo_paths: ['brand-1/r1-0.jpg', 'brand-1/r1-1.jpg'] }])
      expect(repo.signedPhotoUrl).toHaveBeenCalledWith('brand-1/r1-0.jpg')
      const imgs = [...host.querySelectorAll('img')]
      expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['https://signed/brand-1/r1-0.jpg', 'https://signed/brand-1/r1-1.jpg'])
      expect(imgs[0].getAttribute('alt')).toBe('Photo 1 of Lagos General')
    })

    it('a report without photos shows no photo section and asks for no links', async () => {
      await showFeed([{ ...base, id: 'r2' }, { ...base, id: 'r3', photo_paths: [] }])
      expect(repo.signedPhotoUrl).not.toHaveBeenCalled()
      expect(host.textContent).not.toContain('Photos')
    })

    it('a photo the person cannot open reads "Photo unavailable", and the rest of the report still shows', async () => {
      repo.signedPhotoUrl.mockResolvedValue(null)
      await showFeed([{ ...base, id: 'r4', photo_paths: ['brand-1/r4-0.jpg'] }])
      expect(host.textContent).toMatch(/photo unavailable/i)
      expect(host.textContent).toContain('Ada Rep')
    })
  })

  it('opening the form again starts without the previous report\'s photos', async () => {
    await openForm()
    await attach('a.jpg')
    await act(async () => { button('Cancel').click() }); await settle()
    await act(async () => { button('Log Activity').click() }); await settle()
    expect(dialog().querySelectorAll('img')).toHaveLength(0)
  })
})
