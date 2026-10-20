import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import VoicePlayer from './VoicePlayer.jsx'

// Voice notes: a recording is stored under the company's folder for its report; a failed
// upload saves nothing and can be retried; a stored note plays through a signed link that
// is asked for only on press.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    lookupArea: vi.fn(), uploadActivityVoice: vi.fn(), signedVoiceUrl: vi.fn(), getAllFieldActivities: vi.fn(),
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
const STORED = 'https://proj.supabase.co/storage/v1/object/public/activity-voice/brand-1/act-9-k1.webm'

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async () => { await flush(); await flush() }
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
const dialog = () => host.querySelector('[role="dialog"]')
const toastText = () => host.textContent

// A recorder and microphone that behave like the real ones as far as the page can tell.
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

async function recordANote() {
  await act(async () => { button('Start recording').click() })
  await flush()
  await act(async () => { button('Tap to stop').click() })
  await flush()
}
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
}

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
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  repo.uploadActivityVoice.mockResolvedValue(STORED)
  repo.signedVoiceUrl.mockImplementation(async (u) => u.replace('/public/', '/sign/') + '?token=t')
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); delete globalThis.MediaRecorder })

describe('recording and saving a voice note', () => {
  it('stores it under the company and the report it belongs to, and the report keeps the returned URL', async () => {
    await openForm()
    await typeNote('Visited the pharmacy')
    await recordANote()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.uploadActivityVoice).toHaveBeenCalledTimes(1)
    const [blob, where] = repo.uploadActivityVoice.mock.calls[0]
    expect(blob.size).toBeGreaterThan(0)
    expect(where.businessId).toBe('brand-1')
    const saved = repo.logActivity.mock.calls[0][0]
    expect(saved.id).toBe(where.activityId)         // the file is named after the report that owns it
    expect(saved.voice_url).toBe(STORED)
  })

  it('a failed upload saves nothing, keeps the form, says why, and the next try is not a duplicate', async () => {
    repo.uploadActivityVoice.mockRejectedValueOnce(new Error('Voice upload failed (413): too large')).mockResolvedValueOnce(STORED)
    await openForm()
    await typeNote('Visited')
    await recordANote()
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    expect(toastText()).toContain('The voice note did not upload')
    expect(toastText()).toContain('Nothing was saved')
    expect(button('Log It')).toBeTruthy()           // still an ordinary first attempt, not "Retry"
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.uploadActivityVoice).toHaveBeenCalledTimes(2)
    expect(repo.uploadActivityVoice.mock.calls[1][1].activityId).toBe(repo.uploadActivityVoice.mock.calls[0][1].activityId)
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    expect(repo.logActivity.mock.calls[0][0].voice_url).toBe(STORED)
  })

  it('removing the recording after a failed upload lets the report go through without it', async () => {
    repo.uploadActivityVoice.mockRejectedValue(new Error('offline'))
    await openForm()
    await typeNote('Visited')
    await recordANote()
    await act(async () => { button('Log It').click() })
    await flush()
    await act(async () => { button('Remove voice note').click() })
    await act(async () => { button('Log It').click() })
    await flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    expect(repo.logActivity.mock.calls[0][0].voice_url).toBeNull()
  })

  it('if the upload worked but the save failed, the retry does not upload the recording again', async () => {
    repo.logActivity.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({ id: 'x', notification: 'none' })
    await openForm()
    await typeNote('Visited')
    await recordANote()
    await act(async () => { button('Log It').click() })
    await flush()
    await act(async () => { button('Retry').click() })
    await flush()
    expect(repo.uploadActivityVoice).toHaveBeenCalledTimes(1)
    expect(repo.logActivity).toHaveBeenCalledTimes(2)
    expect(repo.logActivity.mock.calls[1][0].voice_url).toBe(STORED)
    expect(repo.logActivity.mock.calls[1][0].id).toBe(repo.logActivity.mock.calls[0][0].id)
  })
})

describe('playing a stored voice note', () => {
  const base = { id: 'r1', business_id: 'brand-1', staff_id: 'staff-1', rep_name: 'Ada Rep', created_at: '2026-10-20T10:00:00Z', values_json: '{}', voice_url: STORED }

  it('on the page it is a button first: no audio element, and no signing request, until pressed', async () => {
    repo.getFieldActivities.mockResolvedValue([base])
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await settle()
    expect(button('Play voice note')).toBeTruthy()
    expect(host.querySelector('audio')).toBeNull()
    expect(repo.signedVoiceUrl).not.toHaveBeenCalled()
    await act(async () => { button('Play voice note').click() })
    await settle()
    expect(repo.signedVoiceUrl).toHaveBeenCalledWith(STORED)
    expect(host.querySelector('audio').getAttribute('src')).toContain('/object/sign/activity-voice/')
  })

  it('a report without a voice note shows no player', async () => {
    repo.getFieldActivities.mockResolvedValue([{ ...base, voice_url: null }])
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await settle()
    expect(button('Play voice note')).toBeUndefined()
  })
})

describe('VoicePlayer on its own', () => {
  const mount = async (resolve) => {
    await act(async () => { root.render(<VoicePlayer url={STORED} resolve={resolve} />) })
  }

  it('asks for the link only when pressed, then plays it', async () => {
    const resolve = vi.fn(async () => 'https://signed.example/a.webm')
    await mount(resolve)
    expect(resolve).not.toHaveBeenCalled()
    await act(async () => { button('Play voice note').click() })
    await flush()
    expect(resolve).toHaveBeenCalledWith(STORED)
    const audio = host.querySelector('audio')
    expect(audio.getAttribute('src')).toBe('https://signed.example/a.webm')
    expect(audio.hasAttribute('controls')).toBe(true)
  })

  it('a link that cannot be made, or a file that will not play, reads as failed and can be retried', async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('https://signed.example/a.webm')
    await mount(resolve)
    await act(async () => { button('Play voice note').click() })
    await flush()
    expect(host.textContent).toContain('could not be played')
    await act(async () => { button('Try again').click() })
    await flush()
    const audio = host.querySelector('audio')
    expect(audio).toBeTruthy()
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    expect(host.textContent).toContain('could not be played')
    expect(host.querySelector('audio')).toBeNull()
  })

  it('shows nothing without a URL', async () => {
    await act(async () => { root.render(<VoicePlayer url={null} resolve={async () => ''} />) })
    expect(host.textContent).toBe('')
  })
})
