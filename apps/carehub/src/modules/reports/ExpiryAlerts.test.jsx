import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExpiryAlerts from './ExpiryAlerts'

// LOAD_ERROR (I/O matrix): any of the three reads rejecting must render the
// error state with a retry action and never crash. The component talks to the
// repository singletons + getProducts directly, so the test mocks those
// modules — the component under test keeps its real logic (state machine,
// horizon/warehouse wiring, summary cards, DataTable).
const mockGetBatches = vi.fn()
const mockGetAll = vi.fn()
const mockGetProducts = vi.fn()

vi.mock('../stock/repositories', () => ({ stockRepository: { getBatches: (...args) => mockGetBatches(...args) } }))
vi.mock('../warehouses/repositories', () => ({ warehouseRepository: { getAll: (...args) => mockGetAll(...args) } }))
vi.mock('../../services/supabase', () => ({ getProducts: (...args) => mockGetProducts(...args) }))

// Fixture dates are computed relative to the real "today" so the default
// 30-day horizon stays deterministic regardless of when the suite runs.
function dateInDays(n) {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function batch(overrides = {}) {
  return {
    id: 'b1', business_id: 'biz', location_id: 'loc1', product_id: 'p1',
    product_name: 'Paracetamol 500mg', batch_number: 'B-1', quantity: 10,
    cost_price: 500, expiry_date: dateInDays(11), status: 'available',
    ...overrides,
  }
}

describe('ExpiryAlerts component', () => {
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

  const render = () => act(async () => {
    root.render(<ExpiryAlerts brand={{ id: 'biz', name: 'Test Pharmacy' }} />)
  })

  const flush = async () => {
    // Loading resolves after the promise chain settles; give the microtasks room.
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })
  }

  const click = (label) => act(async () => {
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  it('renders the error state with a retry action when getBatches rejects', async () => {
    mockGetBatches.mockRejectedValue(new Error('network down'))
    mockGetAll.mockResolvedValue([])
    mockGetProducts.mockResolvedValue([])

    await render()
    await flush()

    const alert = host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('network down')
    const retry = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Retry')
    expect(retry).toBeTruthy()
  })

  it('renders the error state when getAll rejects', async () => {
    mockGetBatches.mockResolvedValue([])
    mockGetAll.mockRejectedValue(new Error('warehouses down'))
    mockGetProducts.mockResolvedValue([])

    await render()
    await flush()

    expect(host.querySelector('[role="alert"]').textContent).toContain('warehouses down')
  })

  it('renders the error state when getProducts rejects', async () => {
    mockGetBatches.mockResolvedValue([])
    mockGetAll.mockResolvedValue([])
    mockGetProducts.mockRejectedValue(new Error('products down'))

    await render()
    await flush()

    expect(host.querySelector('[role="alert"]').textContent).toContain('products down')
  })

  it('recovers after Retry once the load call succeeds', async () => {
    mockGetBatches.mockRejectedValueOnce(new Error('network down'))
    mockGetAll.mockResolvedValue([])
    mockGetProducts.mockResolvedValue([])
    await render()
    await flush()
    expect(host.querySelector('[role="alert"]')).toBeTruthy()

    mockGetBatches.mockResolvedValueOnce([batch()])
    mockGetAll.mockResolvedValueOnce([{ id: 'loc1', name: 'Main Store' }])
    mockGetProducts.mockResolvedValueOnce([{ id: 'p1', name: 'Paracetamol 500mg', cost_price: 500 }])
    await click('Retry')
    await flush()

    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('Batches in view')
    expect(host.textContent).toContain('Paracetamol 500mg')
  })

  it('renders the empty state when no batches are recorded', async () => {
    mockGetBatches.mockResolvedValue([])
    mockGetAll.mockResolvedValue([])
    mockGetProducts.mockResolvedValue([])

    await render()
    await flush()

    expect(host.textContent).toContain('No batches recorded yet')
  })

  it('shows summary cards and rows on a happy path', async () => {
    mockGetBatches.mockResolvedValue([batch()])
    mockGetAll.mockResolvedValue([{ id: 'loc1', name: 'Main Store' }])
    mockGetProducts.mockResolvedValue([{ id: 'p1', name: 'Paracetamol 500mg', cost_price: 500 }])

    await render()
    await flush()

    // "Batches in view" summary shows the derived count for the default 30-day horizon.
    const text = host.textContent
    expect(text).toContain('Batches in view')
    expect(text).toContain('Expected loss')
    expect(text).toContain('₦5,000')
    expect(text).toContain('Paracetamol 500mg')
    // Warehouse selector exposes the fetched location plus Unassigned.
    const opts = [...host.querySelectorAll('select option')].map(o => o.textContent)
    expect(opts).toEqual(['All warehouses', 'Main Store', 'Unassigned'])
  })

  it('excludes out-of-horizon batches under the default 30-day horizon', async () => {
    mockGetBatches.mockResolvedValue([
      batch({ id: 'b1', expiry_date: dateInDays(11) }),
      batch({ id: 'b2', expiry_date: dateInDays(90) }),
    ])
    mockGetAll.mockResolvedValue([{ id: 'loc1', name: 'Main Store' }])
    mockGetProducts.mockResolvedValue([{ id: 'p1', name: 'Paracetamol 500mg', cost_price: 500 }])

    await render()
    await flush()

    // Only the in-horizon batch is listed and counted.
    const rows = [...host.querySelectorAll('tbody tr')].filter(r => r.textContent.includes('B-'))
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('B-1')
    expect(host.textContent).toContain('₦5,000')
  })

  it('filters by warehouse scope', async () => {
    mockGetBatches.mockResolvedValue([
      batch({ id: 'b1', location_id: 'loc1' }),
      batch({ id: 'b2', location_id: 'loc2' }),
    ])
    mockGetAll.mockResolvedValue([{ id: 'loc1', name: 'Main Store' }, { id: 'loc2', name: 'Branch' }])
    mockGetProducts.mockResolvedValue([{ id: 'p1', name: 'Paracetamol 500mg', cost_price: 500 }])

    await render()
    await flush()

    expect([...host.querySelectorAll('tbody tr')].filter(r => r.textContent.includes('B-')).length).toBe(2)

    await act(async () => {
      const select = host.querySelector('select')
      select.value = 'loc1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    const rows = [...host.querySelectorAll('tbody tr')].filter(r => r.textContent.includes('B-'))
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('B-1')
    expect(rows[0].textContent).toContain('Main Store')
  })

  it('shows everything again under the All horizon', async () => {
    mockGetBatches.mockResolvedValue([
      batch({ id: 'b1', expiry_date: dateInDays(11) }),
      batch({ id: 'b2', expiry_date: dateInDays(90) }),
    ])
    mockGetAll.mockResolvedValue([{ id: 'loc1', name: 'Main Store' }])
    mockGetProducts.mockResolvedValue([{ id: 'p1', name: 'Paracetamol 500mg', cost_price: 500 }])

    await render()
    await flush()
    expect([...host.querySelectorAll('tbody tr')].filter(r => r.textContent.includes('B-')).length).toBe(1)

    await click('All')
    await flush()

    const rows = [...host.querySelectorAll('tbody tr')].filter(r => r.textContent.includes('B-'))
    expect(rows.length).toBe(2)
  })
})