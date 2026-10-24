import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Final review C1: custom roles are fetched after the dashboard mounts, and App remounts the whole tree on every
// navigation (<Routes key={location.key}>). The route guards must not judge a custom role before its permissions
// have loaded, or a manufacturer's/wholesaler's custom role is treated as a field rep for a moment and redirected,
// remounted, redirected again... This test uses the REAL permission rules, a delayed roles fetch and a keyed
// <Routes>, the way the app runs.

const auth = vi.hoisted(() => ({ value: null }))
const roles = vi.hoisted(() => ({ value: [] }))

vi.mock('../../../providers/AuthProvider', () => ({ useAuth: vi.fn(() => ({ auth: auth.value, logout: vi.fn() })) }))
vi.mock('../../../modules/staff/repositories', () => ({
  staffRepository: { getRoles: vi.fn(() => new Promise((r) => setTimeout(() => r(roles.value), 30))) },
}))
vi.mock('../../../modules/dashboard-home/DashboardHome', () => ({ default: () => <div data-testid="dashboard-home" /> }))
vi.mock('../../../modules/stock/Stock', () => ({ default: () => <div data-testid="stock-page" /> }))
vi.mock('../../../modules/live-activity/LiveActivity', () => ({ default: () => <div data-testid="field-page" /> }))
vi.mock('../../../modules/live-activity/outbox/OutboxRunner', () => ({ default: () => null }))
vi.mock('../../../components/layout/NotificationBell', () => ({ default: () => null }))
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../../../utils/modulePrefetch', () => ({ startRolePrefetching: vi.fn(), stopPrefetching: vi.fn() }))
vi.mock('../../../modules/pos/repositories', () => ({ saleRepository: { syncQueued: vi.fn(async () => ({ synced: 0, rejected: [] })) } }))
vi.mock('../../../services/supabase', async (importOriginal) => ({
  ...(await importOriginal()),
  getProducts: vi.fn(async () => []), cacheData: vi.fn(), getCached: vi.fn(() => null),
}))

import BusinessDashboard from '../BusinessDashboard'

let paths
function Keyed() {
  const location = useLocation()
  paths.push(location.pathname)
  return (
    <Routes key={location.key}>
      <Route path='/dashboard/*' element={<BusinessDashboard />} />
    </Routes>
  )
}

async function mount(path) {
  paths = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Keyed /></MemoryRouter>) })
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  return { host, unmount: async () => { await act(async () => { root.unmount() }); host.remove() } }
}

describe('custom roles at a manufacturer or wholesaler', () => {
  let m
  afterEach(async () => { if (m) { await m.unmount(); m = null } })

  it('a custom role opens the page its permissions allow, with no redirect loop while its roles load', async () => {
    auth.value = { brand: { id: 'b1', name: 'Wholesale Co', business_type: 'wholesale' }, staff: { id: 's1', full_name: 'Wale Officer', role: 'Warehouse Officer' } }
    roles.value = [{ name: 'Warehouse Officer', permissions: { nav: ['dashboard', 'stock'] } }]
    m = await mount('/dashboard/stock')
    expect(m.host.querySelector('[data-testid="stock-page"]')).toBeTruthy()
    expect(paths.length).toBeLessThan(5)
    expect(paths.at(-1)).toBe('/dashboard/stock')
  })

  it('a custom role keeps its dashboard (it is not treated as a field rep while loading)', async () => {
    auth.value = { brand: { id: 'b1', name: 'Wholesale Co', business_type: 'wholesale' }, staff: { id: 's1', full_name: 'Wale Officer', role: 'Warehouse Officer' } }
    roles.value = [{ name: 'Warehouse Officer', permissions: { nav: ['dashboard', 'stock'] } }]
    m = await mount('/dashboard/dashboard')
    expect(m.host.querySelector('[data-testid="dashboard-home"]')).toBeTruthy()
    expect(paths.length).toBeLessThan(5)
  })

  it('a refused page sends a person to their landing page by an absolute path, in one hop', async () => {
    auth.value = { brand: { id: 'b1', name: 'Pharma Co', business_type: 'manufacturer_importer' }, staff: { id: 's2', full_name: 'Ada Rep', role: 'Medical sales rep' } }
    roles.value = []
    m = await mount('/dashboard/stock')
    expect(m.host.querySelector('[data-testid="field-page"]')).toBeTruthy()
    expect(paths.filter((p) => p.includes('/stock/'))).toEqual([])
    expect(paths.at(-1)).toBe('/dashboard/activity')
  })
})
