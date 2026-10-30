import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Every write the screen makes, in order, so tests can assert what was sent.
const calls = []
let receiveImpl = null

vi.mock('../repositories', () => ({
  purchaseRepository: {
    getPage: async () => [],
    getTotals: async () => [{ purchase_count: 0, total_paid: 0, total_owed: 0 }],
    create: async (...a) => { calls.push(['purchase.create', ...a]); return [{ id: 'pur1' }] },
    update: async () => null,
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
beforeEach(() => {
  calls.length = 0
  receiveImpl = null
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
const render = async (perms = OWNER, { products = [AMOXIL], status = 'ready' } = {}) => {
  await act(async () => { root.render(<Purchases brand={{ id: 'B1' }} role='Owner' perms={perms} products={products} setProducts={() => {}} catalog={{ status, reload: () => {} }} />) })
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
