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
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), reverseGeocode: vi.fn(), uploadActivityVoice: vi.fn(),
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

async function mount({ role, perms, owner = false }) {
  const staff = owner ? undefined : { id: 'me', full_name: 'Me Myself', role }
  localStorage.setItem('carehub_auth', JSON.stringify({ staff, brand: { id: BRAND.id, owner: 'Boss' } }))
  await act(async () => { root.render(<MemoryRouter><LiveActivity brand={BRAND} perms={perms} /></MemoryRouter>) })
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

describe('feed tabs by role', () => {
  it('a manager sees every report under Team Reports, tagged or not', async () => {
    await mount({ role: 'Regional Manager', perms: getPerms('Regional Manager') })
    expect(shown()).toEqual(['own']) // starts on My Feed
    await act(async () => { tab('Team Reports').click() })
    expect(shown()).toEqual(['own', 'untagged', 'tagged'])
  })

  it('a custom role with directory management gets Team Reports without "manager" in its name', async () => {
    await mount({ role: 'Field Coordinator', perms: buildCustomPerms({ canManageDirectory: true }) })
    await act(async () => { tab('Team Reports').click() })
    expect(shown()).toEqual(['own', 'untagged', 'tagged'])
  })

  it('ordinary staff get "Shared with me": only reports tagged to them, never untagged colleagues', async () => {
    await mount({ role: 'Sales Rep', perms: getPerms('Sales Rep') })
    expect(tab('Team Reports')).toBeUndefined()
    await act(async () => { tab('Shared with me').click() })
    expect(shown()).toEqual(['tagged'])
  })

  it('My Feed is only the person\'s own reports, even for a manager who is tagged on others', async () => {
    await mount({ role: 'Manager', perms: getPerms('Manager') })
    await act(async () => { tab('Team Reports').click() })
    await act(async () => { tab('My Feed').click() })
    expect(shown()).toEqual(['own'])
  })
})
