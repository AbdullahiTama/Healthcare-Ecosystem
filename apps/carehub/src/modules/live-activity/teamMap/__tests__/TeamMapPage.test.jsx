import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Field team > Team map: today's check-ins and visits on a map that updates while the manager watches.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const live = vi.hoisted(() => ({ onInsert: null, onStatus: null, stopped: 0 }))
vi.mock('../../../../lib/realtime', () => ({
  watchTable: vi.fn((table, biz, onInsert, onStatus) => { live.onInsert = onInsert; live.onStatus = onStatus; return () => { live.stopped++ } }),
}))
vi.mock('../../../checkins/repositories', () => ({ checkinRepository: { overview: vi.fn() } }))
vi.mock('../../repositories', () => ({ liveActivityRepository: { getFieldActivities: vi.fn() } }))
vi.mock('../../customers/repository.js', () => ({ customerRepository: { list: vi.fn() } }))
vi.mock('../../../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn(async () => [{ id: 't1', name: 'Lagos Island' }]) } }))
vi.mock('../../../staff/repositories', () => ({ staffRepository: { getAll: vi.fn(async () => [{ id: 'ada', full_name: 'Ada' }]) } }))
vi.mock('../LeafletMap.jsx', () => ({
  TONE_COLOR: { current: '#0', earlier: '#1', out: '#2', visit: '#3', quiet: '#4' },
  default: ({ pins }) => <ul data-testid='map'>{pins.map((p) => <li key={p.id} data-pin={p.id} data-tone={p.tone}>{p.title}</li>)}</ul>,
}))

import TeamMapPage from '../TeamMapPage.jsx'
import { checkinRepository } from '../../../checkins/repositories'
import { liveActivityRepository } from '../../repositories'
import { customerRepository } from '../../customers/repository.js'
import { watchTable } from '../../../../lib/realtime'

const ago = (m) => new Date(Date.now() - m * 60000).toISOString()
const BRAND = { id: 'biz-1', business_type: 'manufacturer_importer' }
const CHECKINS = { rows: [
  { staff_id: 'ada', name: 'Ada', role: 'Medical sales rep', last_checkin: { event_type: 'workday_checkin', at: ago(10), latitude: 6.5, longitude: 3.4, location_label: 'Ikeja' } },
  { staff_id: 'bola', name: 'Bola', role: 'Medical sales rep', last_checkin: null },
] }
const VISITS = [{ id: 'v1', created_at: ago(5), rep_name: 'Ada', staff_id: 'ada', facility_name: 'Allen Pharmacy', facility_lat: 6.45, facility_lng: 3.39, facility_verified: true, lat: 6.45, lng: 3.39 }]

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const pinIds = () => [...host.querySelectorAll('[data-pin]')].map((li) => li.getAttribute('data-pin')).sort()
let visibility = 'visible'
async function show() {
  await act(async () => { root.render(<MemoryRouter><TeamMapPage brand={BRAND} customRoles={{}} /></MemoryRouter>) })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  live.onInsert = null; live.onStatus = null; live.stopped = 0
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  checkinRepository.overview.mockResolvedValue(CHECKINS)
  liveActivityRepository.getFieldActivities.mockResolvedValue(VISITS)
  customerRepository.list.mockResolvedValue([{ key: 'f:old', name: 'Old Friend', lat: 6.7, lng: 3.5, last_visit_at: ago(60 * 24 * 40) }])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('Team map', () => {
  it('shows a loading state first', async () => {
    checkinRepository.overview.mockImplementation(() => new Promise(() => {}))
    liveActivityRepository.getFieldActivities.mockImplementation(() => new Promise(() => {}))
    await act(async () => { root.render(<MemoryRouter><TeamMapPage brand={BRAND} customRoles={{}} /></MemoryRouter>) })
    expect(host.textContent).toMatch(/loading the team map/i)
  })

  it('pins today\'s check-ins and visits, and lists them with who has not checked in', async () => {
    await show()
    expect(liveActivityRepository.getFieldActivities).toHaveBeenCalledWith('biz-1', expect.objectContaining({ limit: 500 }))
    expect(pinIds()).toEqual(['rep:ada', 'visit:v1'])
    const text = host.textContent
    expect(text).toContain('Positions as of')
    expect(text).toContain('Allen Pharmacy')
    expect(text).toContain('Not checked in today: Bola')
    expect(text).toContain('Location matches')
  })

  it('Refresh asks for the check-ins again (one logged look)', async () => {
    await show()
    await act(async () => { button('Refresh').click() })
    await flush()
    expect(checkinRepository.overview).toHaveBeenCalledTimes(2)
  })

  it('refreshes check-ins every 5 minutes while the page is visible, not while hidden, and stops when closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await show()
    expect(checkinRepository.overview).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(300000) })
    expect(checkinRepository.overview).toHaveBeenCalledTimes(2)
    visibility = 'hidden'
    await act(async () => { vi.advanceTimersByTime(300000) })
    expect(checkinRepository.overview).toHaveBeenCalledTimes(2)
    visibility = 'visible'
    act(() => root.unmount())
    root = createRoot(host)
    await act(async () => { vi.advanceTimersByTime(600000) })
    expect(checkinRepository.overview).toHaveBeenCalledTimes(2)
    expect(live.stopped).toBe(1)
  })

  it('a new visit arrives live and drops onto the map; one outside the chosen range does not', async () => {
    await show()
    expect(watchTable).toHaveBeenCalledWith('field_activities', 'biz-1', expect.any(Function), expect.any(Function))
    await act(async () => { live.onInsert({ id: 'v2', created_at: ago(1), rep_name: 'Ada', staff_id: 'ada', lat: 6.51, lng: 3.41 }) })
    await act(async () => { live.onInsert({ id: 'old', created_at: ago(60 * 24 * 3), rep_name: 'Ada', staff_id: 'ada', lat: 6.52, lng: 3.42 }) })
    await act(async () => { live.onInsert({ id: 'v2', created_at: ago(1), rep_name: 'Ada', staff_id: 'ada', lat: 6.51, lng: 3.41 }) })
    expect(pinIds()).toEqual(['rep:ada', 'visit:v1', 'visit:v2'])
  })

  it('says whether it is live, and catches up on visits after a dropped connection', async () => {
    await show()
    await act(async () => { live.onStatus('live') })
    expect(host.textContent).toContain('Live: new visits appear as they are logged.')
    await act(async () => { live.onStatus('disconnected') })
    expect(host.textContent).toContain('Not live right now: new visits show when the connection is back.')
    await act(async () => { live.onStatus('live') })
    await flush()
    expect(liveActivityRepository.getFieldActivities).toHaveBeenCalledTimes(2)
  })

  it('a failed source says so with a retry, and the rest still shows', async () => {
    checkinRepository.overview.mockRejectedValueOnce(new Error('Manager access required'))
    await show()
    expect(host.textContent).toMatch(/could not load check-ins: Manager access required/i)
    expect(pinIds()).toEqual(['visit:v1'])
    await act(async () => { button('Try again').click() })
    await flush()
    expect(pinIds()).toEqual(['rep:ada', 'visit:v1'])
  })

  it('nothing yet today says how the map fills', async () => {
    checkinRepository.overview.mockResolvedValue({ rows: [] })
    liveActivityRepository.getFieldActivities.mockResolvedValue([])
    await show()
    expect(host.textContent).toContain('Nothing to show on the map yet. Check-ins and visits appear here as they happen.')
  })

  it('This week loads the week\'s visits', async () => {
    await show()
    await act(async () => { button('This week').click() })
    await flush()
    const since = liveActivityRepository.getFieldActivities.mock.calls.at(-1)[1].since
    expect(Date.now() - Date.parse(since)).toBeGreaterThan(5 * 86400000)
  })

  it('the quiet customers layer loads once when turned on and adds their pins', async () => {
    await show()
    expect(customerRepository.list).not.toHaveBeenCalled()
    const toggle = host.querySelector('input[type="checkbox"]')
    await act(async () => { toggle.click() })
    await flush()
    expect(customerRepository.list).toHaveBeenCalledWith('biz-1', { quietDays: 30 })
    expect(pinIds()).toContain('quiet:f:old')
    await act(async () => { toggle.click() })
    await act(async () => { toggle.click() })
    await flush()
    expect(customerRepository.list).toHaveBeenCalledTimes(1)
  })
})
