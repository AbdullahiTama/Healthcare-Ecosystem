// Regression coverage for the POS barcode lookup paths. A pharmacy reported
// that scanning a registered barcode showed "No products match your search."
// instead of bringing the product up: the search filter only read name and
// generic name, and the hardware-scanner flow (barcode typed into the search
// box, then Enter) had no barcode handling at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// POS reads its server state through the React Query hooks — stub them so the
// component renders against fixture products without a network layer.
vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useOpenSales: vi.fn(() => ({ data: [], isLoading: false })),
  useRecentSales: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [] })),
  useInvalidateSales: vi.fn(() => vi.fn()),
}))

import POS from './POS.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama' }

function WhereAmI() {
  return <div data-testid='location'>{useLocation().pathname}</div>
}

const PRODUCTS = [
  { id: 'p1', name: 'Amoxicillin 500mg', generic_name: 'Amoxicillin', cat: 'Prescription Drugs', category: 'Prescription Drugs', price: 1200, stock: 20, barcode: '6201234567890' },
  { id: 'p2', name: 'Paracetamol 500mg', generic_name: 'Paracetamol', cat: 'OTC Drugs', category: 'OTC Drugs', price: 300, stock: 0, barcode: '6209876543210' },
  { id: 'p3', name: 'Vitamin C 1000mg', generic_name: 'Ascorbic acid', cat: 'Supplements', category: 'Supplements', price: 800, stock: 6, barcode: '6205555555555' },
]

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (desc && desc.set) desc.set.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderPOS() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard/pos']}>
        <Routes>
          <Route path='/dashboard/pos' element={<POS brand={BRAND} products={PRODUCTS} setProducts={vi.fn()} role="Owner" perms={{ canEditPrice: true }} />} />
          <Route path='*' element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>
    )
  })
  await act(async () => {})
  return {
    host,
    unmount: async () => { await act(async () => { root.unmount() }); host.remove() },
  }
}

const searchInput = (host) => host.querySelector('input[aria-label="Search products"]')
const cartHasItem = (host) => !!host.querySelector('button[aria-label="Remove item"]')

async function typeSearch(host, value) {
  await act(async () => { setNativeValue(searchInput(host), value) })
}

async function pressEnter(el) {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

describe('POS barcode lookup', () => {
  let m

  beforeEach(() => { vi.clearAllMocks() })
  afterEach(async () => { if (m) { await m.unmount(); m = null } })

  it('typing or scanning a barcode into the search box shows the matching product', async () => {
    m = await renderPOS()
    await typeSearch(m.host, '6201234567890')
    expect(m.host.textContent).toContain('Amoxicillin 500mg')
    expect(m.host.textContent).not.toContain('Vitamin C 1000mg')
    expect(m.host.textContent).not.toContain('No products match your search.')
  })

  it('shows the empty state when the scanned barcode is not registered', async () => {
    m = await renderPOS()
    await typeSearch(m.host, '0000000000000')
    expect(m.host.textContent).toContain('No products match your search.')
  })

  it('Enter after an exact barcode match adds the product to the current sale', async () => {
    m = await renderPOS()
    await typeSearch(m.host, '6201234567890')
    await pressEnter(searchInput(m.host))
    expect(cartHasItem(m.host)).toBe(true)
    expect(m.host.textContent).toContain('Added: Amoxicillin 500mg')
    // the scan field resets so the next scan starts clean
    expect(searchInput(m.host).value).toBe('')
  })

  it('Enter on an out-of-stock barcode warns and does not add the product', async () => {
    m = await renderPOS()
    await typeSearch(m.host, '6209876543210')
    await pressEnter(searchInput(m.host))
    expect(m.host.textContent).toContain('Paracetamol 500mg is out of stock.')
    expect(cartHasItem(m.host)).toBe(false)
  })

  it('Enter on a non-barcode text search never adds a product', async () => {
    m = await renderPOS()
    await typeSearch(m.host, 'amox')
    await pressEnter(searchInput(m.host))
    expect(cartHasItem(m.host)).toBe(false)
    expect(m.host.textContent).not.toContain('Added:')
  })

  it('the report button beside the scanner opens the Sales & Accounts report', async () => {
    m = await renderPOS()
    const btn = m.host.querySelector('button[aria-label="Sales and accounts report"]')
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    expect(m.host.querySelector('[data-testid="location"]').textContent).toBe('/dashboard/pos/report')
  })

  it('the camera-scan fallback prompt finds products by barcode', async () => {
    // Desktop browsers without BarcodeDetector fall back to a prompt.
    m = await renderPOS()
    vi.stubGlobal('prompt', vi.fn(() => '6201234567890'))
    try {
      await act(async () => {
        m.host.querySelector('button[aria-label="Scan barcode"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await act(async () => {})
      expect(cartHasItem(m.host)).toBe(true)
      expect(m.host.textContent).toContain('Added: Amoxicillin 500mg')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
