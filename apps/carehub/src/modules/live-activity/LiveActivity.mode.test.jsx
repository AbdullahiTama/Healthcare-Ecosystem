import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { getPerms } from '../../lib/permissions'

// One feed, two pages (field team reorganisation): the rep's Field page holds the rep's own tools only; the
// Field team > Team reports page holds the oversight tools only.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), reverseGeocode: vi.fn(), uploadActivityVoice: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}), subscribeChanges: vi.fn(() => () => {}) }))
vi.mock('../checkins/CheckInPanel.jsx', () => ({ default: () => <div data-testid='checkin-panel' /> }))
vi.mock('../checkins/TeamLocations.jsx', () => ({ default: () => <div data-testid='team-locations' /> }))
vi.mock('../../lib/places.js', () => ({
  FACILITY_FILTERS: [], nearbyHealthFacilities: vi.fn(async () => []), getRepAddedFacilities: vi.fn(async () => []),
  confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(), addRepAddedFacility: vi.fn(),
}))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { liveActivityRepository as repo } from './repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const ROW = { id: 'r1', business_id: 'brand-1', staff_id: 'other', rep_name: 'Ada Rep', values_json: '{}', created_at: '2026-10-20T10:00:00Z', lat: 6.5, lng: 3.4, facility_name: 'Lagos General' }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
const has = (testid) => !!host.querySelector('[data-testid="' + testid + '"]')

async function mount({ owner = false, role = 'Regional Manager', mode } = {}) {
  const staff = owner ? undefined : { id: 'me', full_name: 'Me Myself', role }
  localStorage.setItem('carehub_auth', JSON.stringify({ staff, brand: { id: BRAND.id, owner: 'Boss' } }))
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} perms={owner ? undefined : getPerms(role)} mode={mode} /></MemoryRouter>) })
  await flush()
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([ROW])
  repo.countFieldActivities.mockResolvedValue(1)
  repo.getActivityViewers.mockResolvedValue([{ id: 'v', activity_id: 'r1', staff_id: 'me', viewer_name: 'Me' }])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('the Field page (rep mode, the default)', () => {
  it('the owner gets the rep tools: check-in, Log Activity and their own feed', async () => {
    await mount({ owner: true })
    expect(has('checkin-panel')).toBe(true)
    expect(button('Log Activity')).toBeTruthy()
    expect(button('My Feed')).toBeTruthy()
  })

  it('and none of the management tools: no Team Reports, Set up fields, Review facilities or team check-ins', async () => {
    await mount({ owner: true })
    expect(button('Team Reports')).toBeUndefined()
    expect(button('Set up fields')).toBeUndefined()
    expect(button('Review facilities')).toBeUndefined()
    expect(has('team-locations')).toBe(false)
  })

  it('a manager on their Field page gets no Compare location on a report they were tagged on', async () => {
    await mount()
    await act(async () => { button('Shared with me').click() })
    expect(host.textContent).toContain('Ada Rep')
    expect(button('Compare location')).toBeUndefined()
  })

  it('there is no "filter by rep" on a page about the person\'s own work', async () => {
    await mount()
    expect(host.textContent).not.toContain('All reps')
  })

  it('a rep still sets who sees their activity', async () => {
    await mount({ role: 'Sales Rep' })
    expect(button('Who sees my activity')).toBeTruthy()
  })
})

describe('Team reports (team mode)', () => {
  it('shows the whole team\'s reports with the oversight tools: table, export, filter by rep, compare location', async () => {
    await mount({ mode: 'team' })
    expect(host.textContent).toContain('Ada Rep')
    expect(button('Table')).toBeTruthy()
    expect(button('Export')).toBeTruthy()
    expect(host.textContent).toContain('All reps')
    expect(button('Compare location')).toBeTruthy()
  })

  it('has none of the rep tools: no check-in, no Log Activity, no Who sees my activity, no tabs', async () => {
    await mount({ mode: 'team' })
    expect(has('checkin-panel')).toBe(false)
    expect(button('Log Activity')).toBeUndefined()
    expect(button('+ Log Activity')).toBeUndefined()
    expect(button('Who sees my activity')).toBeUndefined()
    expect(button('My Feed')).toBeUndefined()
    expect(button('Shared with me')).toBeUndefined()
  })

  it('the management sheets are their own pages now, not buttons here', async () => {
    await mount({ owner: true, mode: 'team' })
    expect(button('Set up fields')).toBeUndefined()
    expect(button('Review facilities')).toBeUndefined()
  })

  it('its title says what it is', async () => {
    await mount({ mode: 'team' })
    expect(host.textContent).toContain('Team reports')
  })
})
