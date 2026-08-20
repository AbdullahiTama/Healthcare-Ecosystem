import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ReportsHub from './ReportsHub'

// The expiry feature is only reachable through ReportsHub's /dashboard/reports/expiry
// mount, so a regression in the hub wiring (dropped import, key typo, missing
// subtitle) must fail here rather than silently rendering a blank pane. The
// registry data is pinned in permissions.test.js; this test pins that the hub
// actually mounts ExpiryAlerts for an Owner and redirects roles without access.
// Sibling modules are mocked so the test observes hub wiring, not their bodies.
const mockGetBatches = vi.fn()
const mockGetAll = vi.fn()
const mockGetProducts = vi.fn()

vi.mock('../stock/repositories', () => ({ stockRepository: { getBatches: (...args) => mockGetBatches(...args) } }))
vi.mock('../warehouses/repositories', () => ({ warehouseRepository: { getAll: (...args) => mockGetAll(...args) } }))
vi.mock('../../services/supabase', () => ({
  getProducts: (...args) => mockGetProducts(...args),
  sbFetch: vi.fn(),
  sbUpload: vi.fn(),
}))
vi.mock('./Reports', () => ({ default: () => <div data-testid="reports-mock">Reports body</div> }))
vi.mock('../adr/AdrReportsList', () => ({ default: () => <div data-testid="adr-mock">ADR body</div> }))

describe('ReportsHub expiry wiring', () => {
  let host
  let root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mockGetBatches.mockReset()
    mockGetAll.mockReset()
    mockGetProducts.mockReset()
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  const renderHub = (role, businessType, path) => act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/reports/:tab" element={
            <ReportsHub role={role} brand={{ id: 'biz', business_type: businessType, name: 'Test Pharmacy' }} />
          } />
        </Routes>
      </MemoryRouter>
    )
  })

  const flush = async () => {
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
  }

  it('mounts ExpiryAlerts for an Owner opening /dashboard/reports/expiry', async () => {
    mockGetBatches.mockResolvedValue([{
      id: 'b1', business_id: 'biz', location_id: 'loc1', product_id: 'p1',
      product_name: 'Paracetamol 500mg', batch_number: 'B-1', quantity: 10,
      cost_price: 500, expiry_date: '2099-01-01', status: 'available',
    }])
    mockGetAll.mockResolvedValue([{ id: 'loc1', name: 'Main Store' }])
    mockGetProducts.mockResolvedValue([{ id: 'p1', name: 'Paracetamol 500mg', cost_price: 500 }])

    await renderHub('Owner', 'pharmacy', '/dashboard/reports/expiry')
    await flush()

    const text = host.textContent
    expect(text).toContain('Expiry Alerts')
    expect(text).toContain('Batches expiring soon, per warehouse, with expected loss value')
    expect(text).toContain('Batches in view')
    expect(host.querySelector('[role="tablist"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="reports-mock"]')).toBeNull()
    expect(host.querySelector('[data-testid="adr-mock"]')).toBeNull()
  })

  it('redirects a Pharmacist opening the expiry path to their default ADR tab', async () => {
    mockGetBatches.mockResolvedValue([])
    mockGetAll.mockResolvedValue([])
    mockGetProducts.mockResolvedValue([])

    await renderHub('Pharmacist', 'pharmacy', '/dashboard/reports/expiry')
    await flush()

    // Pharmacist's report tabs are ['adr-reports'] only; the hub must not
    // render the expiry module and must land them on their default tab.
    const tabs = [...host.querySelectorAll('[role="tab"]')].map(t => t.textContent)
    expect(tabs).not.toContain('Expiry Alerts')
    expect(host.querySelector('[data-testid="adr-mock"]')).toBeTruthy()
    expect(host.textContent).not.toContain('Batches in view')
  })
})