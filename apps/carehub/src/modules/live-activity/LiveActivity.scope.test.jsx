import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { getPerms, buildCustomPerms } from '../../lib/permissions'

// Which reports each role sees under the two feed tabs. The database decides what
// a person may READ (every row below is one the policy already returned); this
// guards the page from hiding rows the database let through. Regression: Team
// Reports filtered a manager's feed down to the reports they were tagged on.

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
const at = (m) => new Date(Date.UTC(2026, 9, 19, 12, 0, 0) - m * 60000).toISOString()
const ROWS = [
  { id: 'own', business_id: 'brand-1', staff_id: 'me', rep_name: 'Me Myself', values_json: '{}', created_at: at(1) },
  { id: 'untagged', business_id: 'brand-1', staff_id: 'other', rep_name: 'Untagged Colleague', values_json: '{}', created_at: at(2) },
  { id: 'tagged', business_id: 'brand-1', staff_id: 'other', rep_name: 'Tagging Colleague', values_json: '{}', created_at: at(3) },
]
const TAG = [{ id: 'v1', activity_id: 'tagged', staff_id: 'me', viewer_name: 'Tagged Viewer' }]

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const tab = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
const shown = () => ROWS.filter((r) => host.textContent.includes(r.rep_name)).map((r) => r.id)

async function mount({ role, perms, owner = false, mode }) {
  const staff = owner ? undefined : { id: 'me', full_name: 'Me Myself', role }
  localStorage.setItem('carehub_auth', JSON.stringify({ staff, brand: { id: BRAND.id, owner: 'Boss' } }))
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} perms={perms} mode={mode} /></MemoryRouter>) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue(ROWS)
  repo.countFieldActivities.mockResolvedValue(3)
  repo.getActivityViewers.mockResolvedValue(TAG)
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

// The rep's Field page (mode "rep", the default) is about the person's own work, for everyone, managers too:
// My Feed and Shared with me. The whole team is the Field team > Team reports page (mode "team").
describe('feed tabs on the Field page (rep mode)', () => {
  it('a manager gets My Feed and Shared with me, and no Team Reports tab', async () => {
    await mount({ role: 'Regional Manager', perms: getPerms('Regional Manager') })
    expect(shown()).toEqual(['own']) // starts on My Feed
    expect(tab('Team Reports')).toBeUndefined()
    expect(tab('Shared with me')).toBeTruthy()
  })

  it('a manager\'s "Shared with me" is only reports they are tagged on, never the whole team', async () => {
    await mount({ role: 'Regional Manager', perms: getPerms('Regional Manager') })
    await act(async () => { tab('Shared with me').click() })
    expect(shown()).toEqual(['tagged'])
  })

  it('the owner starts on their own reports too', async () => {
    await mount({ owner: true })
    expect(tab('Team Reports')).toBeUndefined()
  })

  it('ordinary staff get "Shared with me": only reports tagged to them, never untagged colleagues', async () => {
    await mount({ role: 'Sales Rep', perms: getPerms('Sales Rep') })
    expect(tab('Team Reports')).toBeUndefined()
    await act(async () => { tab('Shared with me').click() })
    expect(shown()).toEqual(['tagged'])
  })
})

describe('Team reports (team mode)', () => {
  it('a manager sees every report, tagged or not, with no tabs to switch', async () => {
    await mount({ role: 'Regional Manager', perms: getPerms('Regional Manager'), mode: 'team' })
    expect(shown()).toEqual(['own', 'untagged', 'tagged'])
    expect(tab('My Feed')).toBeUndefined()
  })

  it('a custom role with "Manage field team" sees the whole team without "manager" in its name', async () => {
    await mount({ role: 'Field Coordinator', perms: buildCustomPerms({ canManageDirectory: true }), mode: 'team' })
    expect(shown()).toEqual(['own', 'untagged', 'tagged'])
  })
})

describe('what the page asks the server for', () => {
  it('rep mode: My Feed asks for my reports; Shared with me asks for everyone else\'s, then keeps the tagged ones', async () => {
    await mount({ role: 'Manager', perms: getPerms('Manager') })
    expect(repo.getFieldActivities.mock.calls.at(-1)[1]).toMatchObject({ limit: 100, staffId: 'me' })
    await act(async () => { tab('Shared with me').click() })
    await flush()
    expect(repo.getFieldActivities.mock.calls.at(-1)[1]).toEqual({ limit: 100, excludeStaffId: 'me' })
  })

  it('team mode asks for the whole team, with no author narrowing', async () => {
    await mount({ role: 'Manager', perms: getPerms('Manager'), mode: 'team' })
    const team = repo.getFieldActivities.mock.calls.at(-1)[1]
    expect(team).toEqual({ limit: 100 })
  })

  it('team mode counts the whole team exactly on the server', async () => {
    await mount({ role: 'Manager', perms: getPerms('Manager'), mode: 'team' })
    expect(repo.countFieldActivities).toHaveBeenCalledWith('brand-1', {})
  })

  it('exports everything the filters match from the server, not just the loaded page', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    repo.getAllFieldActivities.mockResolvedValue({ rows: [ROWS[0], ROWS[1], ROWS[2]], truncated: false })
    await mount({ role: 'Manager', perms: getPerms('Manager'), mode: 'team' })
    await flush()
    await act(async () => { tab('Export').click() })
    await flush()
    expect(repo.getAllFieldActivities).toHaveBeenCalledTimes(1)
    const [bizId, opts] = repo.getAllFieldActivities.mock.calls[0]
    expect(bizId).toBe('brand-1')
    expect(opts).toMatchObject({ since: null, until: null })
    expect(opts.staffId).toBeUndefined() // Team reports: no author narrowing
    expect(host.textContent).toContain('Exported 3 records')
  })

  it('says so when an export hit the cap', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    repo.getAllFieldActivities.mockResolvedValue({ rows: [ROWS[0]], truncated: true })
    await mount({ role: 'Manager', perms: getPerms('Manager'), mode: 'team' })
    await act(async () => { tab('Export').click() })
    await flush()
    expect(host.textContent).toContain('narrow the dates')
  })
})
