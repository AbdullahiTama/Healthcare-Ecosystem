import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// What the products page shows while the shared catalog loads, fails, is a
// saved copy, or is genuinely empty (catalog state from useProductCatalog).

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), cacheData: vi.fn(), getCached: vi.fn(() => null) }))

import Inventory from './Inventory.jsx'

let host, root
const brand = { id: 'biz-1', plan: 'pro' }
const perms = { canEditStock: true, canDelete: true, canExportReports: true }
const products = [
  { id: '1', name: 'Amoxil', generic_name: 'Amoxicillin', category: 'Medicines', price: 100, stock: 10, reorder_level: 2 },
  { id: '2', name: 'Panadol', generic_name: 'Paracetamol', category: 'Medicines', price: 50, stock: 20, reorder_level: 2 },
]
const catalog = (over = {}) => ({ status: 'ready', refreshing: false, stale: false, staleReason: null, loadedCount: 0, error: null, reload: vi.fn(), ...over })

async function render(props) {
  await act(async () => {
    root.render(<MemoryRouter><Inventory brand={brand} perms={perms} role='owner' setProducts={vi.fn()} products={[]} {...props} /></MemoryRouter>)
  })
}
const text = () => host.textContent
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('Inventory catalog states', () => {
  it('loading: shows progress and skeletons (not "no products"), and waits to enable list-wide actions', async () => {
    await render({ catalog: catalog({ status: 'loading', loadedCount: 2000 }) })
    expect(text()).toContain('Loading products… 2,000 loaded')
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(text()).not.toMatch(/No products/)
    expect(button('Add product').disabled).toBe(true)
    expect(button('Upload CSV').disabled).toBe(true)
    expect(button('Export Excel').disabled).toBe(true)
  })

  it('error with nothing to show: an alert with Retry that calls reload', async () => {
    const c = catalog({ status: 'error', error: "We couldn't load your products. Check your connection and try again." })
    await render({ catalog: c })
    expect(host.querySelector('[role="alert"]').textContent).toContain("couldn't load your products")
    await act(async () => button('Retry').click())
    expect(c.reload).toHaveBeenCalled()
  })

  it('saved copy after a failed refresh: products shown with a warning and Try again', async () => {
    const c = catalog({ stale: true, staleReason: 'failed' })
    await render({ catalog: c, products })
    expect(text()).toContain('Amoxil')
    expect(text()).toContain('Showing the copy saved on this device')
    await act(async () => button('Try again').click())
    expect(c.reload).toHaveBeenCalled()
  })

  it('offline saved copy: says so, without a pointless Try again', async () => {
    await render({ catalog: catalog({ stale: true, staleReason: 'offline' }), products })
    expect(text()).toContain("You're offline")
    expect(button('Try again')).toBeUndefined()
  })

  it('refreshing behind products on screen: a polite status line, list stays usable', async () => {
    await render({ catalog: catalog({ refreshing: true, loadedCount: 1000 }), products })
    expect(host.querySelector('[role="status"]').textContent).toContain('Updating your product list… 1,000 loaded')
    expect(button('Add product').disabled).toBe(false)
  })

  it('genuinely empty: "No products yet" with a way to add one', async () => {
    await render({ catalog: catalog(), products: [] })
    expect(text()).toContain('No products yet')
    expect(button('+ Add product')).toBeDefined()
  })

  it('filtered to nothing: says no match and Clear filters restores the list', async () => {
    await render({ catalog: catalog(), products })
    const input = host.querySelector('input[placeholder^="Search name"]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'zzz-not-a-product')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(text()).toContain('No products match')
    await act(async () => button('Clear filters').click())
    expect(text()).toContain('Amoxil')
  })

  it('renders as loaded when no catalog state is passed (older callers)', async () => {
    await render({ products })
    expect(text()).toContain('Panadol')
  })
})
