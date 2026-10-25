// Products belong to one location, so a cart built at one location must never be checked out at another. While the
// POS cart has items, a location switch has to ask first (the switch then remounts the page and the cart is cleared).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useAllSales: vi.fn(() => ({ data: [], isLoading: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [] })),
  useInvalidateSales: vi.fn(() => vi.fn()),
}))

import POS from './POS.jsx'
import { switchBlockers } from '../../lib/locationSwitch.js'

const PRODUCTS = [
  { id: 'p1', name: 'Amoxicillin 500mg', cat: 'Prescription Drugs', category: 'Prescription Drugs', price: 1200, stock: 20, barcode: '6201234567890' },
  { id: 'p3', name: 'Vitamin C 1000mg', cat: 'Supplements', category: 'Supplements', price: 800, stock: 6, barcode: '6205555555555' },
]

let host, root
afterEach(async () => { if (root) { await act(async () => { root.unmount() }); host.remove(); root = null } })

async function renderPOS() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<POS brand={{ id: 'biz-1', name: 'Pharm Tama' }} products={PRODUCTS} setProducts={vi.fn()} role='Owner' perms={{ canEditPrice: true }} />) })
  await act(async () => {})
}
// As a scanner does: the barcode typed into the search box, then Enter, adds the product to the sale.
async function addToCart(name) {
  const barcode = PRODUCTS.find((p) => p.name === name).barcode
  const input = host.querySelector('input[aria-label="Search products"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, barcode)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

describe('POS and location switching', () => {
  it('an empty cart does not hold a switch back', async () => {
    await renderPOS()
    expect(switchBlockers()).toEqual([])
  })

  it('a cart with items asks before a switch, naming how many items would be cleared', async () => {
    await renderPOS()
    await addToCart('Amoxicillin 500mg')
    await addToCart('Vitamin C 1000mg')
    expect(host.querySelectorAll('button[aria-label="Remove item"]').length).toBe(2)
    expect(switchBlockers()).toEqual(['Your POS cart has 2 items. Switching location clears it.'])
  })

  it('leaving the POS stops holding switches back', async () => {
    await renderPOS()
    await addToCart('Amoxicillin 500mg')
    await act(async () => { root.unmount() }); host.remove(); root = null
    expect(switchBlockers()).toEqual([])
  })
})
