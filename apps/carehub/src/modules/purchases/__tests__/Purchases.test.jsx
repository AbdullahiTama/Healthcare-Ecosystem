import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Every write the screen makes, in order, so tests can assert what was sent.
const calls = []
let receiveImpl = null
let supplierRows = []
let productStatRows = []
let pageRows = []

vi.mock('../repositories', () => ({
  purchaseRepository: {
    getPage: async () => pageRows,
    getTotals: async () => [{ purchase_count: 0, total_paid: 0, total_owed: 0 }],
    create: async (...a) => { calls.push(['purchase.create', ...a]); return [{ id: 'pur1' }] },
    // The supplier picker and the "last bought" insight.
    getSupplierStats: async () => supplierRows,
    getSupplierBalances: async () => [],
    getProductStats: async () => productStatRows,
  },
}))
vi.mock('../../inventory/repositories', () => ({
  productRepository: {
    receiveStock: async (...a) => {
      calls.push(['product.receiveStock', ...a])
      if (receiveImpl) return receiveImpl(...a)
      return { stock: 99, replayed: false }
    },
    update: async (...a) => { calls.push(['product.update', ...a]); return { id: a[0], ...a[2] } },
    create: async (...a) => { calls.push(['product.create', ...a]); return [{ id: 'new1' }] },
  },
}))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../debts/repositories', () => ({
  debtRepository: {
    recordUnderpayment: async (...a) => { calls.push(['debt.recordUnderpayment', ...a]) },
    findOpenBySource: async () => null,
    update: async () => null,
  },
}))

import Purchases from '../Purchases'

const AMOXIL = { id: 'p1', name: 'Amoxil 500mg', generic_name: 'Amoxicillin', category: 'Medicines', price: 1500, cost_price: 800, stock: 24 }
const OWNER = { canEditPrice: true, canEditStock: true }
const MANAGER = { canEditPrice: false, canEditStock: false }
const DRAFT_KEY = 'carehub_draft_purchase_B1_owner'

let host
let root
let qc
beforeEach(() => {
  calls.length = 0
  receiveImpl = null
  supplierRows = []
  productStatRows = []
  pageRows = []
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  localStorage.clear()
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
// The dashboard's shared catalog: `products` plus its load status.
const render = async (perms = OWNER, { products = [AMOXIL], status = 'ready', role = 'Owner' } = {}) => {
  await act(async () => { root.render(<QueryClientProvider client={qc}><Purchases brand={{ id: 'B1' }} role={role} perms={perms} products={products} setProducts={() => {}} catalog={{ status, reload: () => {} }} /></QueryClientProvider>) })
  await flush()
}
const type = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = (text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))
const field = (line, name) => host.querySelectorAll(`[id^="pi-"][id$="-${name}"]`)[line]
const openForm = async () => { await click(button('+ Record Purchase')); await flush() }

describe('Purchases — bulk stock entry', () => {
  it('fills in an existing product\'s details when it is picked and moves to Quantity', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    expect(field(0, 'cost').value).toBe('800')
    expect(field(0, 'sell').value).toBe('1500')
    expect(field(0, 'qty').value).toBe('')
    expect(host.textContent).toContain('In inventory')
    expect(host.textContent).toContain('Amoxicillin')
    expect(document.activeElement).toBe(field(0, 'qty'))
    await type(field(0, 'qty'), '10')
    expect(host.textContent).toMatch(/Stock\s*24\s*→\s*34 after saving/)
  })

  it('keeps the draft across a reload and reopens the form where it was', async () => {
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '12')

    // Simulate the browser discarding and reloading the tab.
    await act(async () => { root.unmount() })
    root = createRoot(host)
    await render()

    expect(host.querySelector('#purchase-supplier').value).toBe('MedSupply Ltd')
    expect(field(0, 'qty').value).toBe('12')
    expect(host.textContent).toContain('Picked up where you left off')
  })

  it('does not close on a backdrop tap, and Close keeps the draft for later', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    await click(host.querySelector('[role="dialog"]'))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()

    await click(button('Close'))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('Unsaved purchase draft')
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()

    await click(button('Resume'))
    expect(field(0, 'name').value).toBe('Amoxil 500mg')
  })

  it('refuses to save while a started line is incomplete instead of dropping it', async () => {
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '10')
    await click(button('Add another item'))
    await type(field(1, 'name'), 'Brand New Syrup')
    await click(button('Save Purchase'))
    await flush()

    expect(calls.filter(c => c[0] === 'purchase.create')).toHaveLength(0)
    expect(host.textContent).toContain('Line 2 needs attention')
    expect(field(1, 'qty').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field(1, 'qty'))
  })

  it('receives each line through the stock ledger with its own batch and key, then clears the draft', async () => {
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '10')
    await type(field(0, 'batch'), 'A1')
    await type(field(0, 'expiry'), '2027-01-01')
    await click(button('Add another item'))
    await type(field(1, 'name'), 'Amoxil 500mg')
    await type(field(1, 'qty'), '5')
    await type(field(1, 'batch'), 'A2')
    await type(field(1, 'expiry'), '2027-06-01')
    await type(host.querySelector('#purchase-amount-paid'), '12000')
    await click(button('Save Purchase'))
    await flush()

    const receipts = calls.filter(c => c[0] === 'product.receiveStock')
    expect(receipts.map(c => [c[1], c[2], c[3], c[4].batchNumber, c[4].expiryDate])).toEqual([
      ['B1', 'p1', 10, 'A1', '2027-01-01'],
      ['B1', 'p1', 5, 'A2', '2027-06-01'],
    ])
    for (const [, , , , opts] of receipts) {
      expect(opts).toMatchObject({ movementType: 'purchase_receipt', sourceType: 'purchase', sourceId: 'pur1', supplier: 'MedSupply Ltd', reason: 'Purchase from MedSupply Ltd' })
      expect(opts.idempotencyKey).toMatch(/^purchase:pur1:/)
    }
    expect(new Set(receipts.map(c => c[4].idempotencyKey)).size).toBe(2)
    expect(calls.filter(c => c[0] === 'product.create')).toHaveLength(0)
    // Cost is written once per product, never stock.
    expect(calls.filter(c => c[0] === 'product.update').map(c => c[3])).toEqual([{ cost_price: 800 }])
    const purchase = calls.find(c => c[0] === 'purchase.create')[2]
    expect(purchase).toMatchObject({ supplier_name: 'MedSupply Ltd', quantity: 15, total_cost: 12000, amount_paid: 12000, status: 'paid' })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('does not let a role without price permission reprice an existing product', async () => {
    await render(MANAGER)
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    expect(field(0, 'sell').readOnly).toBe(true)
    await type(field(0, 'qty'), '4')
    await type(field(0, 'cost'), '850')
    await click(button('Save Purchase'))
    await flush()

    const update = calls.find(c => c[0] === 'product.update')
    expect(update[3]).toEqual({ cost_price: 850 })
  })

  it('reverts a price typed before the product list loaded when the role cannot reprice', async () => {
    await render(MANAGER, { products: [], status: 'loading' })
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '2')
    await type(field(0, 'cost'), '800')
    await type(field(0, 'sell'), '2000')
    await render(MANAGER)

    expect(field(0, 'sell').readOnly).toBe(true)
    expect(field(0, 'sell').value).toBe('1500')
    await click(button('Save Purchase'))
    await flush()
    expect(calls.find(c => c[0] === 'product.update')[3]).toEqual({ cost_price: 800 })
  })

  it('blocks saving until the product list has loaded, so existing products are not duplicated', async () => {
    await render(OWNER, { products: [], status: 'loading' })
    await openForm()
    expect(host.textContent).toContain('Loading your products')
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '3')
    await type(field(0, 'cost'), '800')
    expect(button('Loading products').disabled).toBe(true)
    expect(calls.filter(c => c[0] === 'purchase.create')).toHaveLength(0)

    // Once the list arrives the typed line is linked to the existing product.
    await render()
    expect(host.textContent).toContain('In inventory')
    await click(button('Save Purchase'))
    await flush()
    expect(calls.filter(c => c[0] === 'product.create')).toHaveLength(0)
    expect(calls.filter(c => c[0] === 'product.receiveStock').map(c => [c[2], c[3]])).toEqual([['p1', 3]])
  })

  it('creates a new product empty, then receives its units as this purchase', async () => {
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Brand New Syrup')
    await type(field(0, 'qty'), '6')
    await type(field(0, 'cost'), '400')
    await click(button('Save Purchase'))
    await flush()

    expect(calls.find(c => c[0] === 'product.create')[2]).toMatchObject({ name: 'Brand New Syrup', stock: 0, cost_price: 400 })
    expect(calls.filter(c => c[0] === 'product.receiveStock').map(c => [c[2], c[3], c[4].movementType])).toEqual([['new1', 6, 'purchase_receipt']])
  })

  it('asks for the batch and expiry of a product tracked by batch before saving anything', async () => {
    const INSULIN = { id: 'p9', name: 'Insulin Pen', category: 'Medicines', price: 9000, cost_price: 6000, stock: 4, tracking_mode: 'batch_expiry' }
    await render(OWNER, { products: [AMOXIL, INSULIN] })
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Insulin Pen')
    await type(field(0, 'qty'), '2')
    expect(host.textContent).toContain('tracked by batch and expiry')
    await click(button('Save Purchase'))
    await flush()

    expect(calls.filter(c => c[0] === 'purchase.create')).toHaveLength(0)
    expect(field(0, 'batch').getAttribute('aria-invalid')).toBe('true')
    expect(field(0, 'expiry').getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain('Batch number needed')
  })

  it('names a line the stock ledger refused, with the reason', async () => {
    receiveImpl = async () => {
      const e = new Error('This product is tracked by batch. Enter its batch number.')
      e.code = 'BATCH_REQUIRED'
      throw e
    }
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '2')
    await click(button('Save Purchase'))
    await flush()
    expect(host.textContent).toContain('Not added to Inventory: Amoxil 500mg (This product is tracked by batch. Enter its batch number.)')
  })
})

describe('Purchases — suppliers, barcodes and purchase insight', () => {
  const MEDSUPPLY = { supplier_key: 'medsupply ltd', supplier_name: 'MedSupply Ltd', purchase_count: 4, total_spent: 52000, amount_paid: 40000, balance: 12000, last_date: '2026-10-30', last_total: 9000 }
  const listbox = () => host.querySelector('#purchase-supplier-list')

  it('lists existing suppliers while typing, picks one, and shows what was spent and is owed', async () => {
    supplierRows = [MEDSUPPLY]
    await render()
    await openForm()
    const input = host.querySelector('#purchase-supplier')
    await act(async () => { input.focus() })
    await type(input, 'med')
    expect(listbox().hidden).toBe(false)
    const option = [...listbox().querySelectorAll('[role="option"]')].find(o => o.textContent.includes('MedSupply Ltd'))
    expect(option.textContent).toContain('owed')
    await click(option)
    expect(input.value).toBe('MedSupply Ltd')
    expect(host.textContent).toContain('Existing supplier')
    expect(host.textContent).toContain('₦52,000')
    expect(host.textContent).toContain('₦12,000')
  })

  it('warns about a near-duplicate supplier and offers the existing one', async () => {
    supplierRows = [MEDSUPPLY]
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'Medsupply Limited')
    expect(host.textContent).toContain('looks like a supplier you already have')
    await click(button('Use MedSupply Ltd'))
    expect(host.querySelector('#purchase-supplier').value).toBe('MedSupply Ltd')
  })

  it('typing an existing product\'s barcode links the line; the barcode is shown read-only', async () => {
    await render(OWNER, { products: [{ ...AMOXIL, barcode: '6151100001' }] })
    await openForm()
    await type(field(0, 'barcode'), '6151100001')
    expect(field(0, 'name').value).toBe('Amoxil 500mg')
    expect(field(0, 'cost').value).toBe('800')
    expect(field(0, 'barcode').readOnly).toBe(true)
    expect(document.activeElement).toBe(field(0, 'qty'))
  })

  it('a barcode entered for a product without one is saved on it, and new products get theirs', async () => {
    await render()
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '2')
    await type(field(0, 'barcode'), '8901234567890')
    await click(button('Add another item'))
    await type(field(1, 'name'), 'Brand New Syrup')
    await type(field(1, 'qty'), '3')
    await type(field(1, 'cost'), '400')
    await type(field(1, 'barcode'), '8909999999999')
    await click(button('Save Purchase'))
    await flush()
    expect(calls.find(c => c[0] === 'product.update')[3]).toEqual({ cost_price: 800, barcode: '8901234567890' })
    expect(calls.find(c => c[0] === 'product.create')[2]).toMatchObject({ name: 'Brand New Syrup', barcode: '8909999999999' })
    // Each line keeps its id (the stock receipt key) and product for later edits.
    const items = calls.find(c => c[0] === 'purchase.create')[2].items
    const keys = calls.filter(c => c[0] === 'product.receiveStock').map(c => c[4].sourceLineId)
    expect(items.map(i => i.id)).toEqual(keys)
    expect(items[0]).toMatchObject({ product_id: 'p1', barcode: '8901234567890' })
  })

  it('a barcode that belongs to another product blocks the save and says whose it is', async () => {
    await render(OWNER, { products: [AMOXIL, { id: 'p2', name: 'Panadol', price: 100, cost_price: 50, stock: 3, barcode: '777' }] })
    await openForm()
    await type(host.querySelector('#purchase-supplier'), 'MedSupply Ltd')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '2')
    // Typed into the barcode field of a line already linked to Amoxil.
    await act(async () => {
      const el = field(0, 'barcode')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '777')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // The barcode linked the line to Panadol (its product); picking Amoxil again
    // keeps the typed barcode, which belongs to Panadol.
    expect(field(0, 'name').value).toBe('Panadol')
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'qty'), '2')
    expect(field(0, 'barcode').value).toBe('777')
    await click(button('Save Purchase'))
    await flush()
    expect(calls.filter(c => c[0] === 'purchase.create')).toHaveLength(0)
    expect(field(0, 'barcode').getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain('Belongs to Panadol')
  })

  it('offers to move a barcode typed into the batch field', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    await type(field(0, 'batch'), '8903882000125')
    expect(host.textContent).toContain('The batch number looks like a barcode')
    await click(button('Move it to Barcode'))
    expect(field(0, 'batch').value).toBe('')
    expect(field(0, 'barcode').value).toBe('8903882000125')
  })

  it('shows when a picked product was last bought, at what price, and the change from it', async () => {
    productStatRows = [{ product_key: 'amoxil 500mg', product_id: 'p1', product_name: 'Amoxil 500mg', times_purchased: 3, units: 40, total_spent: 30000, avg_cost: 750,
      last_date: '2026-10-01', last_supplier: 'MedSupply Ltd', last_qty: 10, last_cost: 800, previous_cost: 700, total_count: 1 }]
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    await flush()
    expect(host.textContent).toContain('Last bought')
    expect(host.textContent).toContain('from MedSupply Ltd')
    expect(host.textContent).toContain('before that ₦700')
    expect(host.textContent).toContain('bought 3 times')
    await type(field(0, 'cost'), '880')
    expect(host.textContent).toContain('+10% vs last price')
  })

  it('offers Edit to the Owner and to a role granted "Edit purchases", not to others', async () => {
    pageRows = [{ id: 'pur9', supplier_name: 'MedSupply Ltd', product_name: 'Amoxil 500mg', quantity: 10, total_cost: 8000, amount_paid: 8000, balance: 0, supply_date: '2026-10-30' }]
    await render()
    expect(host.querySelector('[aria-label="Edit purchase from MedSupply Ltd"]')).not.toBeNull()
    await act(async () => { root.unmount() }); root = createRoot(host)
    await render(MANAGER, { role: 'Manager' })
    expect(host.querySelector('[aria-label="Edit purchase from MedSupply Ltd"]')).toBeNull()
    await act(async () => { root.unmount() }); root = createRoot(host)
    await render({ ...MANAGER, canEditPurchases: true }, { role: 'Store Lead' })
    expect(host.querySelector('[aria-label="Edit purchase from MedSupply Ltd"]')).not.toBeNull()
  })
})

// A USB scanner in keyboard mode: every character is a keydown followed by the
// input it produces, a few milliseconds apart, then usually Enter. Keydowns
// fired back to back here are well inside the scan pace.
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const scanWithScanner = async (input, code, suffix = 'Enter') => {
  await act(async () => {
    for (const ch of code) {
      key(input, ch)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, input.value + ch)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (suffix) key(input, suffix)
  })
}

describe('Purchases — USB barcode scanner goes to the Barcode field', () => {
  it('a scan while Quantity has focus fills Barcode and leaves Quantity and the stock alone', async () => {
    await render(OWNER, { products: [AMOXIL] })
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    expect(document.activeElement).toBe(field(0, 'qty'))
    await type(field(0, 'qty'), '10')
    await scanWithScanner(field(0, 'qty'), '8901234567890')
    expect(field(0, 'qty').value).toBe('10')
    expect(field(0, 'barcode').value).toBe('8901234567890')
    expect(host.textContent).toMatch(/Stock\s*24\s*→\s*34 after saving/)
    // The scanner's Enter did not move on to a new line.
    expect(host.querySelectorAll('[id^="pi-"][id$="-qty"]')).toHaveLength(1)
    expect(document.activeElement).toBe(field(0, 'qty'))
    expect(host.textContent).toContain('Scanned 8901234567890 into the barcode of item 1.')
  })

  it('a scan of a known product from Quantity links the line to it, without typing into Quantity', async () => {
    await render(OWNER, { products: [AMOXIL, { id: 'p2', name: 'Panadol', price: 100, cost_price: 50, stock: 3, barcode: '6151100001' }] })
    await openForm()
    await act(async () => { field(0, 'qty').focus() })
    await scanWithScanner(field(0, 'qty'), '6151100001')
    expect(field(0, 'name').value).toBe('Panadol')
    expect(field(0, 'cost').value).toBe('50')
    expect(field(0, 'qty').value).toBe('')
    expect(field(0, 'barcode').value).toBe('6151100001')
    expect(document.activeElement).toBe(field(0, 'qty'))
  })

  it('a scan into Batch no. or Unit cost goes to Barcode instead', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    await scanWithScanner(field(0, 'batch'), '8903882000125', 'Tab')
    expect(field(0, 'batch').value).toBe('')
    expect(field(0, 'barcode').value).toBe('8903882000125')
    expect(host.textContent).not.toContain('The batch number looks like a barcode')
    await scanWithScanner(field(0, 'cost'), '8903882000125')
    expect(field(0, 'cost').value).toBe('800')
  })

  it('an unknown code scanned into Product becomes the barcode, not the product name', async () => {
    await render()
    await openForm()
    await scanWithScanner(field(0, 'name'), '8909999999999')
    expect(field(0, 'name').value).toBe('')
    expect(field(0, 'barcode').value).toBe('8909999999999')
  })

  it('goes to the line the scan was typed into', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    await click(button('Add another item'))
    await type(field(1, 'name'), 'Brand New Syrup')
    await scanWithScanner(field(1, 'qty'), '8909999999999')
    expect(field(0, 'barcode').value).toBe('')
    expect(field(1, 'barcode').value).toBe('8909999999999')
  })

  it('a scan outside the lines (Amount Paid) goes to a new line, and Amount Paid is unchanged', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    const paid = host.querySelector('#purchase-amount-paid')
    await type(paid, '500')
    await scanWithScanner(paid, '8909999999999')
    expect(paid.value).toBe('500')
    expect(field(0, 'barcode').value).toBe('')
    expect(field(1, 'barcode').value).toBe('8909999999999')
  })

  it('a scanner that sends no Enter is still caught once the keys stop', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    await scanWithScanner(field(0, 'qty'), '8901234567890', null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(field(0, 'qty').value).toBe('')
    expect(field(0, 'barcode').value).toBe('8901234567890')
  })

  it('typing a long number by hand into Quantity stays in Quantity', async () => {
    await render()
    await openForm()
    await type(field(0, 'name'), 'Amoxil 500mg')
    const qty = field(0, 'qty')
    for (const ch of '1200000') {
      await act(async () => {
        key(qty, ch)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(qty, qty.value + ch)
        qty.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    await act(async () => { key(qty, 'Enter') })
    expect(qty.value).toBe('1200000')
    expect(field(0, 'barcode').value).toBe('')
  })

  it('leaves Notes alone (an invoice number may be scanned there)', async () => {
    await render()
    await openForm()
    const notes = host.querySelector('#purchase-notes')
    await act(async () => {
      for (const ch of 'INV000123') {
        key(notes, ch)
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(notes, notes.value + ch)
        notes.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    expect(notes.value).toBe('INV000123')
    expect(field(0, 'barcode').value).toBe('')
  })
})

