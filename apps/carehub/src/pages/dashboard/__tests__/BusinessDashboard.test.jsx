import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// D1 shell migration (spec-d1-business-dashboard-foundation): BusinessDashboard
// must render through the shared DashboardShell (skip link + main landmark +
// nav slot) while keeping every module route behind the unchanged guard table.

const onlineState = vi.hoisted(() => ({ value: true }))

vi.mock('../../../modules/dashboard-home/DashboardHome', () => ({
  default: function MockDashboardHome() {
    return <div data-testid="dashboard-home">Dashboard home</div>
  },
}))
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: vi.fn(() => ({
    auth: {
      brand: { id: 'biz-1', name: 'Pharma Hub', business_type: 'pharmacy' },
      staff: { id: 'u1', full_name: 'Ada Owner', role: 'Owner' },
    },
    logout: vi.fn(),
  })),
}))
vi.mock('../../../components/layout/NotificationBell', () => ({ default: () => null }))
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => onlineState.value }))
vi.mock('../../../utils/modulePrefetch', () => ({
  startRolePrefetching: vi.fn(),
  stopPrefetching: vi.fn(),
}))
vi.mock('../../../modules/staff/repositories', () => ({
  staffRepository: { getRoles: vi.fn(async () => []) },
}))
vi.mock('../../../modules/pos/repositories', () => ({
  saleRepository: { syncQueued: vi.fn(async () => ({ synced: 0, rejected: [] })) },
}))
vi.mock('../../../services/supabase', async (importOriginal) => ({
  ...(await importOriginal()),
  getProducts: vi.fn(async () => []),
  cacheData: vi.fn(),
  getCached: vi.fn(() => null),
}))
vi.mock('../../../modules/live-activity/LiveActivity', () => ({
  default: function MockField({ mode }) { return <div data-testid="field-page" data-mode={mode || 'rep'}>Field</div> },
}))
vi.mock('../../../modules/checkins/TeamLocations', () => ({ default: () => <div data-testid="team-checkins" /> }))
vi.mock('../../../modules/orders/Orders', () => ({
  default: function MockOrders({ view }) { return <div data-testid="orders" data-view={view || 'all'} /> },
}))
vi.mock('../../../modules/live-activity/PlacesToConfirm', () => ({ default: () => <div data-testid="places" /> }))
vi.mock('../../../modules/live-activity/ReportFieldsSetup', () => ({ default: () => <div data-testid="report-fields" /> }))
// The nav is stubbed per test; landingRoute is the real one, so the redirect rule under test is production code.
vi.mock('../../../lib/permissions', async (importOriginal) => {
  const real = await importOriginal()
  const StubIcon = () => null
  return {
    landingRoute: real.landingRoute,
    getNavItems: vi.fn(() => [['dashboard'], ['pos'], ['inventory'], ['expenses'], ['reports']]),
    getPerms: vi.fn(() => ({ nav: ['dashboard', 'pos', 'inventory', 'expenses', 'reports'] })),
    getReportTabs: vi.fn(() => ['reports']),
    getNavGroups: vi.fn(() => [{
      id: 'main',
      label: 'Menu',
      items: [['dashboard', StubIcon, 'Dashboard'], ['pos', StubIcon, 'POS / Sales']],
    }]),
    modulePath: vi.fn((key) => '/dashboard/' + key),
    isModuleActive: vi.fn(() => false),
  }
})

import BusinessDashboard from '../BusinessDashboard'
import { getNavItems, getPerms } from '../../../lib/permissions'

async function mountDashboard(path = '/dashboard') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path='/dashboard/*' element={<BusinessDashboard />} />
        </Routes>
      </MemoryRouter>
    )
  })
  // Flush the lazy route chunk, auth/product effects and nested renders.
  for (let i = 0; i < 8; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
  return {
    host,
    unmount: async () => {
      await act(async () => { root.unmount() })
      host.remove()
    },
  }
}

describe('BusinessDashboard shell migration', () => {
  let m
  afterEach(async () => {
    if (m) { await m.unmount(); m = null }
    onlineState.value = true
    vi.clearAllMocks()
  })

  it('renders DashboardShell landmarks: skip link, main landmark and nav slot', async () => {
    m = await mountDashboard()

    const skip = m.host.querySelector('a[href="#ds-main-content"]')
    expect(skip).toBeTruthy()
    expect(skip.textContent).toContain('Skip to main content')

    const main = m.host.querySelector('main#ds-main-content')
    expect(main).toBeTruthy()
    expect(main.getAttribute('tabindex')).toBe('-1')

    expect(m.host.querySelector('nav')).toBeTruthy()
    expect(m.host.querySelector('[aria-label="Sign Out"]')).toBeTruthy()
  })

  it('renders the home route inside the main landmark', async () => {
    m = await mountDashboard()
    const main = m.host.querySelector('main#ds-main-content')
    const home = m.host.querySelector('[data-testid="dashboard-home"]')
    expect(home).toBeTruthy()
    expect(main.contains(home)).toBe(true)
  })

  it('a Business Admin who opens /dashboard/directory by URL is sent back to the dashboard (management is platform-only)', async () => {
    m = await mountDashboard('/dashboard/directory')
    expect(m.host.querySelector('[data-testid="dashboard-home"]')).toBeTruthy()
    expect(m.host.textContent).not.toMatch(/Business Directory/i)
  })

  it('shows the offline strip in the topbar slot when offline', async () => {
    onlineState.value = false
    m = await mountDashboard()
    expect(m.host.textContent).toContain('You are offline. Sales are saved on this device and will sync when you reconnect.')
  })

  it('does not show the offline strip when online', async () => {
    m = await mountDashboard()
    expect(m.host.textContent).not.toContain('You are offline.')
  })
})

describe('where a field rep lands', () => {
  let m
  const REP_NAV = [['activity'], ['orders'], ['messages']]
  afterEach(async () => {
    if (m) { await m.unmount(); m = null }
    getNavItems.mockReset()
    getNavItems.mockImplementation(() => [['dashboard'], ['pos'], ['inventory'], ['expenses'], ['reports']])
  })

  it('a rep (no dashboard in their menu) opening /dashboard lands on Field, not in a redirect loop', async () => {
    getNavItems.mockReturnValue(REP_NAV)
    m = await mountDashboard('/dashboard')
    expect(m.host.querySelector('[data-testid="field-page"]')).toBeTruthy()
    expect(m.host.querySelector('[data-testid="dashboard-home"]')).toBeNull()
  })

  it('a rep who types the URL of a page they do not have lands on Field', async () => {
    getNavItems.mockReturnValue(REP_NAV)
    m = await mountDashboard('/dashboard/pos')
    expect(m.host.querySelector('[data-testid="field-page"]')).toBeTruthy()
  })

  it('an unknown path sends a rep to Field too', async () => {
    getNavItems.mockReturnValue(REP_NAV)
    m = await mountDashboard('/dashboard/no-such-page')
    expect(m.host.querySelector('[data-testid="field-page"]')).toBeTruthy()
  })

  it('someone with the dashboard still lands on the dashboard', async () => {
    getNavItems.mockReturnValue([['dashboard'], ['activity']])
    m = await mountDashboard('/dashboard')
    expect(m.host.querySelector('[data-testid="dashboard-home"]')).toBeTruthy()
  })
})

describe('the Field team pages', () => {
  let m
  const MANAGER_NAV = [['dashboard'], ['activity'], ['field-reports'], ['field-checkins'], ['field-approvals'], ['field-places'], ['field-fields']]
  afterEach(async () => {
    if (m) { await m.unmount(); m = null }
    getNavItems.mockReset()
    getNavItems.mockImplementation(() => [['dashboard'], ['pos'], ['inventory'], ['expenses'], ['reports']])
  })
  const at = async (path) => { getNavItems.mockReturnValue(MANAGER_NAV); m = await mountDashboard(path); return m.host }

  it('Team reports is the activity feed in team mode', async () => {
    const host = await at('/dashboard/field-team/reports')
    expect(host.querySelector('[data-testid="field-page"]').getAttribute('data-mode')).toBe('team')
  })
  it('Team check-ins shows the team check-in view', async () => {
    expect((await at('/dashboard/field-team/checkins')).querySelector('[data-testid="team-checkins"]')).toBeTruthy()
  })
  it('Order approvals is the Orders page in its approvals view', async () => {
    const host = await at('/dashboard/field-team/approvals')
    expect(host.querySelector('[data-testid="orders"]').getAttribute('data-view')).toBe('approvals')
  })
  it('Places to confirm and Report fields have their own pages', async () => {
    expect((await at('/dashboard/field-team/places')).querySelector('[data-testid="places"]')).toBeTruthy()
    await m.unmount(); m = null
    expect((await at('/dashboard/field-team/fields')).querySelector('[data-testid="report-fields"]')).toBeTruthy()
  })
  it('the rep\'s own Field page is still the activity feed in rep mode', async () => {
    const host = await at('/dashboard/activity')
    expect(host.querySelector('[data-testid="field-page"]').getAttribute('data-mode')).toBe('rep')
  })
  it('a rep who types a Field team URL is sent to their Field page instead', async () => {
    getNavItems.mockReturnValue([['activity'], ['orders'], ['messages']])
    m = await mountDashboard('/dashboard/field-team/reports')
    const page = m.host.querySelector('[data-testid="field-page"]')
    expect(page).toBeTruthy()
    expect(page.getAttribute('data-mode')).toBe('rep')
  })
})
