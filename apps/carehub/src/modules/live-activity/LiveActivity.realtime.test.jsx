import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Realtime never replays what it missed, and "connected" does not prove every
// report is being delivered. These tests drive the page the way the socket does:
// pushes, status changes, and reaction/comment events.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    reverseGeocode: vi.fn(), uploadActivityVoice: vi.fn(), getAllFieldActivities: vi.fn(),
    reactToActivity: vi.fn(), unreactToActivity: vi.fn(), commentOnActivity: vi.fn(),
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
import { watchTable, subscribeChanges } from '../../lib/realtime'
import { liveActivityRepository as repo } from './repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const STAFF = { id: 'me', full_name: 'Me Myself', role: 'Regional Manager' }
const row = (id, name, minutesAgo, staff = 'other') => ({
  id, business_id: 'brand-1', staff_id: staff, rep_name: name, values_json: '{}',
  created_at: new Date(Date.UTC(2026, 9, 20, 12, 0, 0) - minutesAgo * 60000).toISOString(),
})
const A = row('a', 'Alpha Rep', 5)
const B = row('b', 'Bravo Rep', 3)
const C = row('c', 'Charlie Rep', 1)

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
const cards = () => ['Alpha Rep', 'Bravo Rep', 'Charlie Rep'].filter((n) => host.textContent.includes(n))
const count = (name) => host.textContent.split(name).length - 1
const onInsert = () => watchTable.mock.calls[0][2]
const onStatus = () => watchTable.mock.calls[0][3]
const engagementCb = (table) => subscribeChanges.mock.calls.find((c) => c[0].table === table)[1]

// The live team feed is Field team > Team reports (team mode).
async function mount() {
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} mode='team' /></MemoryRouter>) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([A])
  repo.countFieldActivities.mockResolvedValue(1)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.reactToActivity.mockResolvedValue([])
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers() })

describe('catching up', () => {
  it('a report saved while the subscription was being set up shows once the connection is confirmed, without blanking the feed', async () => {
    await mount()
    expect(cards()).toEqual(['Alpha Rep'])
    repo.getFieldActivities.mockResolvedValue([B, A])  // B landed in the gap
    await act(async () => { onStatus()('live') })
    expect(host.textContent).toContain('Alpha Rep')     // still there while it fetches
    await flush()
    expect(cards()).toEqual(['Alpha Rep', 'Bravo Rep'])
    expect(count('Bravo Rep')).toBeGreaterThanOrEqual(1)
  })

  it('rows missed while disconnected arrive on reconnect, newest first, each card once', async () => {
    await mount()
    await act(async () => { onStatus()('live') }); await flush()
    await act(async () => { onStatus()('disconnected') })
    repo.getFieldActivities.mockResolvedValue([C, B, A])
    await act(async () => { onStatus()('live') }); await flush()
    expect(cards()).toEqual(['Alpha Rep', 'Bravo Rep', 'Charlie Rep'])
    const order = ['Charlie Rep', 'Bravo Rep', 'Alpha Rep'].map((n) => host.textContent.indexOf(n))
    expect(order).toEqual([...order].sort((x, y) => x - y)) // Charlie, Bravo, Alpha on screen
    expect(count('Charlie Rep')).toBe(1)
  })

  it('the same report delivered by a push AND a catch-up is one card', async () => {
    await mount()
    await act(async () => { onInsert()(B) })
    repo.getFieldActivities.mockResolvedValue([B, A])
    await act(async () => { onStatus()('live') }); await flush()
    expect(count('Bravo Rep')).toBe(1)
  })

  it('a failed catch-up leaves the feed as it was', async () => {
    await mount()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.getFieldActivities.mockRejectedValue(new Error('offline'))
    await act(async () => { onStatus()('live') }); await flush()
    expect(cards()).toEqual(['Alpha Rep'])
    spy.mockRestore()
  })

  it('a pushed report from someone else has its viewers fetched shortly after, once they are written', async () => {
    vi.useFakeTimers()
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    repo.getActivityViewers.mockClear()
    await act(async () => { onInsert()(C) })
    expect(repo.getActivityViewers).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
    expect(repo.getActivityViewers).toHaveBeenCalledTimes(1)
    expect(repo.getActivityViewers.mock.calls[0][0]).toEqual(['c'])
  })
})

describe('reactions and comments', () => {
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(700) }) }
  beforeEach(() => {
    repo.getFieldActivities.mockResolvedValue([A, B])
  })

  it('an event for one report refreshes only that report', async () => {
    vi.useFakeTimers()
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    repo.getActivityReactions.mockClear(); repo.getActivityComments.mockClear()
    await act(async () => { engagementCb('activity_reactions')({ eventType: 'INSERT', new: { activity_id: 'b' } }); await vi.advanceTimersByTimeAsync(700) })
    expect(repo.getActivityReactions).toHaveBeenCalledTimes(1)
    expect(repo.getActivityReactions.mock.calls[0][0]).toEqual(['b'])
    expect(repo.getActivityComments.mock.calls[0][0]).toEqual(['b'])
  })

  it('a burst across two reports is one request covering both', async () => {
    vi.useFakeTimers()
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    repo.getActivityReactions.mockClear()
    await act(async () => {
      engagementCb('activity_reactions')({ eventType: 'INSERT', new: { activity_id: 'a' } })
      engagementCb('activity_comments')({ eventType: 'INSERT', new: { activity_id: 'b' } })
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(repo.getActivityReactions).toHaveBeenCalledTimes(1)
    expect(repo.getActivityReactions.mock.calls[0][0].sort()).toEqual(['a', 'b'])
  })

  it('an event for a report that is not on screen fetches nothing', async () => {
    vi.useFakeTimers()
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    repo.getActivityReactions.mockClear()
    await act(async () => { engagementCb('activity_reactions')({ eventType: 'INSERT', new: { activity_id: 'elsewhere' } }); await vi.advanceTimersByTimeAsync(700) })
    expect(repo.getActivityReactions).not.toHaveBeenCalled()
  })

  it('a delete does not name its report, so every loaded report is rechecked', async () => {
    vi.useFakeTimers()
    await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} /></MemoryRouter>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    repo.getActivityReactions.mockClear()
    await act(async () => { engagementCb('activity_reactions')({ eventType: 'DELETE', old: { id: 'r1' } }); await vi.advanceTimersByTimeAsync(700) })
    expect(repo.getActivityReactions.mock.calls[0][0].sort()).toEqual(['a', 'b'])
  })

  it('your own reaction refreshes that report only, and does not reload the whole page', async () => {
    repo.getFieldActivities.mockResolvedValue([A])
    await mount()
    const feedLoads = repo.getFieldActivities.mock.calls.length
    const staffLoads = staffRepository.getAll.mock.calls.length
    repo.getActivityReactions.mockClear()
    await act(async () => { button('Acknowledge').click() })
    await flush()
    expect(repo.reactToActivity).toHaveBeenCalledTimes(1)
    expect(repo.getActivityReactions.mock.calls[0][0]).toEqual(['a'])
    expect(repo.getFieldActivities.mock.calls.length).toBe(feedLoads)
    expect(staffRepository.getAll.mock.calls.length).toBe(staffLoads)
  })
})

describe('what the status badge claims', () => {
  it('says updates are on, not that every report is guaranteed', async () => {
    await mount()
    await act(async () => { onStatus()('live') }); await flush()
    expect(host.textContent).toContain('UPDATES ON')
    expect(host.textContent).not.toMatch(/\bLIVE\b/)
    expect(host.textContent).not.toContain('moment it lands')
    const badge = host.querySelector('[data-live-status="live"]')
    expect(badge.getAttribute('title')).toContain('Reload if one seems to be missing')
  })

  it('when paused it says it is reconnecting by itself rather than telling the person to reload', async () => {
    await mount()
    await act(async () => { onStatus()('disconnected') })
    const badge = host.querySelector('[data-live-status="disconnected"]')
    expect(badge.textContent).toContain('UPDATES PAUSED')
    expect(badge.getAttribute('title')).toContain('reconnecting by itself')
    expect(badge.getAttribute('title')).not.toContain('Reload to reconnect')
  })
})
