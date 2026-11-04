// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. In Inventory that was the product form's Stock
// Quantity or a price, the Restock dialog's Units, or the search box (which
// did not match barcodes); a focused Save button was pressed by the Enter.
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), cacheData: vi.fn(), getCached: vi.fn(() => null) }))
vi.mock('./repositories', () => ({
  productRepository: {
    getAll: async () => [],
    update: async (...a) => { calls.push(['update', ...a]); return { id: a[0], ...a[2] } },
    create: async (...a) => { calls.push(['create', ...a]); return [{ id: 'new' }] },
    receiveStock: async (...a) => { calls.push(['receiveStock', ...a]); return { stock: 99, replayed: false } },
    delete: async () => null,
    mergeDuplicates: async () => null,
  },
}))

import Inventory from './Inventory.jsx'

const AMOXIL = { id: 'p1', name: 'Amoxil 500mg', generic_name: 'Amoxicillin', category: 'Medicines', price: 1500, cost_price: 800, stock: 50, reorder_level: 5, barcode: '6151100001' }
const INSULIN = { id: 'p2', name: 'Insulin Pen', generic_name: 'Insulin', category: 'Medicines', price: 9000, cost_price: 7000, stock: 4, reorder_level: 2, tracking_mode: 'batch' }
const OWNER = { canEditPrice: true, canEditStock: true, canDelete: true }
const catalog = { status: 'ready', refreshing: false, stale: false, staleReason: null, loadedCount: 0, error: null, reload: () => {} }

let host
let root
beforeEach(() => {
  calls.length = 0
  global.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const render = async (products = [AMOXIL, INSULIN]) => {
  await act(async () => { root.render(<MemoryRouter><Inventory brand={{ id: 'B1', plan: 'pro' }} products={products} setProducts={() => {}} catalog={catalog} role='Owner' perms={OWNER} /></MemoryRouter>) })
  await flush()
}
const setValue = (el, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const type = (el, value) => act(async () => { setValue(el, value) })
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const buttons = (text) => [...host.querySelectorAll('button')].filter(b => b.textContent.trim() === text)
const byLabel = (text) => {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(text))
  return label && document.getElementById(label.htmlFor)
}
const dialog = () => host.querySelector('[role="dialog"]')
const keydown = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
// The scanner: a keydown and its input per character, back to back, then Enter.
async function scan(el, code, suffix = 'Enter') {
  await act(async () => {
    for (const ch of code) {
      keydown(el, ch)
      if (el.tagName === 'INPUT') setValue(el, el.value + ch)
    }
    if (suffix) keydown(el, suffix)
  })
}

describe('Inventory — product form: a scan goes into Barcode', () => {
  it('a scan while Stock Quantity has focus fills Barcode and leaves Stock alone', async () => {
    await render()
    await click(buttons('Add product')[0])
    await type(byLabel('Product Name'), 'New Syrup')
    await type(byLabel('Stock Quantity'), '12')
    await scan(byLabel('Stock Quantity'), '8909999999999')
    expect(byLabel('Stock Quantity').value).toBe('12')
    expect(byLabel('Barcode').value).toBe('8909999999999')
    expect(host.textContent).toContain('Scanned 8909999999999 into Barcode.')
    expect(dialog()).not.toBeNull()
  })

  it('the scanner\'s Enter on a focused Save button does not save', async () => {
    await render()
    await click(buttons('Add product')[0])
    await type(byLabel('Product Name'), 'New Syrup')
    await type(byLabel('Selling Price'), '500')
    const save = buttons('Add Product')[0]
    let enterReachedButton = 0
    save.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterReachedButton++ })
    await scan(save, '8909999999999')
    expect(enterReachedButton).toBe(0)
    expect(calls.filter(c => c[0] === 'create')).toHaveLength(0)
    expect(byLabel('Barcode').value).toBe('8909999999999')
  })

  it('a scan into a price leaves the price as it was', async () => {
    await render()
    await click(buttons('Edit')[0])
    await scan(byLabel('Selling Price'), '6151100001', 'Tab')
    expect(byLabel('Selling Price').value).toBe('1500')
    expect(byLabel('Barcode').value).toBe('6151100001')
  })

  it('warns when the scanned code already belongs to another product', async () => {
    await render()
    await click(buttons('Edit')[1]) // Insulin Pen
    await scan(byLabel('Stock Quantity'), '6151100001')
    expect(byLabel('Barcode').value).toBe('6151100001')
    expect(host.textContent).toContain('Barcode 6151100001 already belongs to Amoxil 500mg.')
  })

  it('typing a long stock count by hand stays in Stock', async () => {
    await render()
    await click(buttons('Add product')[0])
    const stock = byLabel('Stock Quantity')
    for (const ch of '1200000') {
      await act(async () => { keydown(stock, ch); setValue(stock, stock.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(stock.value).toBe('1200000')
    expect(byLabel('Barcode').value).toBe('')
  })
})

describe('Inventory — Restock: a scan is never added as stock', () => {
  it('a scan into Units is undone and explained', async () => {
    await render()
    await click(buttons('+ Stock')[0])
    const units = host.querySelector('#restock-units')
    await type(units, '10')
    await scan(units, '6151100001')
    expect(units.value).toBe('10')
    expect(host.textContent).toContain('Scanned 6151100001 was not added. Type the number of units to add.')
    expect(calls.filter(c => c[0] === 'receiveStock')).toHaveLength(0)
  })

  it('the scanner\'s Enter on the focused + Add Stock button does not add stock', async () => {
    await render()
    await click(buttons('+ Stock')[0])
    const add = buttons('+ Add Stock')[0]
    let enterReachedButton = 0
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterReachedButton++ })
    await scan(add, '6151100001')
    await flush()
    expect(enterReachedButton).toBe(0)
    expect(calls.filter(c => c[0] === 'receiveStock')).toHaveLength(0)
  })

  it('a batch number scanned from a label stays in Batch', async () => {
    await render()
    await click(buttons('+ Stock')[1]) // Insulin Pen, tracked by batch
    const batch = host.querySelector('#restock-batch')
    await scan(batch, 'INS0412A', null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(batch.value).toBe('INS0412A')
  })
})

describe('Inventory — list: a scan opens its product', () => {
  it('a scan with nothing focused opens the product', async () => {
    await render()
    await scan(document.body, '6151100001')
    expect(dialog()).not.toBeNull()
    expect(byLabel('Product Name').value).toBe('Amoxil 500mg')
    expect(host.textContent).toContain('Found: Amoxil 500mg')
  })

  it('a scan into the search box opens the product and keeps what was typed before it', async () => {
    await render()
    const search = host.querySelector('input[aria-label="Search products"]')
    await type(search, 'ins')
    await scan(search, '6151100001')
    expect(byLabel('Product Name').value).toBe('Amoxil 500mg')
    expect(search.value).toBe('ins')
  })

  it('an unknown code goes into search with a message', async () => {
    await render()
    await scan(document.body, '8900000000000')
    expect(dialog()).toBeNull()
    expect(host.querySelector('input[aria-label="Search products"]').value).toBe('8900000000000')
    expect(host.textContent).toContain('No product has the barcode 8900000000000.')
  })

  it('search finds a product by a typed barcode', async () => {
    await render()
    await type(host.querySelector('input[aria-label="Search products"]'), '6151100001')
    expect(host.textContent).toContain('Amoxil 500mg')
    expect(host.textContent).not.toContain('Insulin Pen')
  })

  it('fields outside Inventory are left alone', async () => {
    await render()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      await scan(outside, '6151100001')
      expect(outside.value).toBe('6151100001')
      expect(dialog()).toBeNull()
    } finally {
      outside.remove()
    }
  })
})
