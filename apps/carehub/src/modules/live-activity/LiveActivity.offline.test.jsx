import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// A report written without a connection is kept on the device and sent later. A refusal is never queued,
// and when the device cannot keep the report the person is told plainly that nothing was kept.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    lookupArea: vi.fn(), uploadActivityVoice: vi.fn(), signedVoiceUrl: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('./outbox', () => ({
  liveActivityOutbox: {
    enqueue: vi.fn(), list: vi.fn(async () => []), subscribe: vi.fn(() => () => {}),
    flush: vi.fn(), retry: vi.fn(), discard: vi.fn(), start: vi.fn(() => () => {}),
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

class FakeRecorder {
  static isTypeSupported() { return true }
  constructor() { this.state = 'inactive' }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(['voice'], { type: 'audio/webm' }) })
    if (this.onstop) this.onstop()
  }
}
// With no company-defined fields the form asks for one required note ("What happened").
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
async function recordANote() {
  await act(async () => { button('Start recording').click() })
  await flush()
  await act(async () => { button('Tap to stop').click() })
  await flush()
}
const submit = async () => { await act(async () => { button('Log It').click() }); await settle() }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  globalThis.MediaRecorder = FakeRecorder
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } })
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: undefined })
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([{ viewer_staff_id: 'm1', viewer_name: 'Mo Manager' }])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  repo.uploadActivityVoice.mockResolvedValue('https://x/storage/v1/object/public/activity-voice/brand-1/a.mp4')
  repo.signedVoiceUrl.mockImplementation(async (u) => u)
  outbox.enqueue.mockImplementation(async (e) => ({ id: e.activity.id }))
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); delete globalThis.MediaRecorder })

describe('writing a report without a connection', () => {
  it('a dropped connection queues the report on the device, closes the form and says so', async () => {
    repo.logActivity.mockRejectedValue(new TypeError('Failed to fetch'))
    await openForm()
    await submit()
    expect(outbox.enqueue).toHaveBeenCalledTimes(1)
    const queued = outbox.enqueue.mock.calls[0][0]
    expect(queued.activity.id).toBeTruthy()
    expect(queued.activity.rep_name).toBe('Ada Rep')
    expect(queued.viewers.map((v) => v.staff_id)).toEqual(['m1'])   // the viewers the person chose travel with it
    expect(dialog()).toBeNull()
    expect(host.textContent).toMatch(/saved on this device/i)
    expect(host.textContent).not.toContain('may already be saved')
  })

  it('a refusal is never queued: it would be refused again', async () => {
    repo.logActivity.mockRejectedValue(new Error('Supabase error (403): new row violates row-level security policy'))
    await openForm()
    await submit()
    expect(outbox.enqueue).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    expect(host.textContent).toContain('Could not finish saving')
  })

  it('when the device cannot keep the report, the form stays open and the person is told it was NOT kept', async () => {
    repo.logActivity.mockRejectedValue(new TypeError('Failed to fetch'))
    outbox.enqueue.mockRejectedValue(Object.assign(new Error('full'), { name: 'OutboxStoreError', code: 'quota' }))
    await openForm()
    await submit()
    expect(dialog()).toBeTruthy()
    expect(host.textContent).toMatch(/could not be kept on this device/i)
    expect(host.textContent).toContain('may already be saved')   // the existing retry path still works
    expect(button('Retry')).toBeTruthy()
  })

  it('a voice note recorded offline is queued WITH its recording, and the report is not sent without it', async () => {
    repo.uploadActivityVoice.mockRejectedValue(new TypeError('Failed to fetch'))
    await openForm()
    await recordANote()
    await submit()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(outbox.enqueue).toHaveBeenCalledTimes(1)
    const queued = outbox.enqueue.mock.calls[0][0]
    expect(queued.voiceBlob).toBeInstanceOf(Blob)
    expect(queued.activity.voice_url).toBeNull()
    expect(dialog()).toBeNull()
  })

  it('a refused voice upload is not queued; the person keeps the form and the old message', async () => {
    repo.uploadActivityVoice.mockRejectedValue(new Error('Supabase error (403): new row violates row-level security policy'))
    await openForm()
    await recordANote()
    await submit()
    expect(outbox.enqueue).not.toHaveBeenCalled()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(host.textContent).toContain('The voice note did not upload')
    expect(dialog()).toBeTruthy()
  })
})
