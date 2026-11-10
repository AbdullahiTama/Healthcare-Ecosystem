// Inventory bulk actions: mark products, edit them together, delete the marked ones or everything (to re-upload),
// and restore. The database function decides what is deleted; the page reflects exactly that.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ updateMany: vi.fn(), deleteProducts: vi.fn(), restoreDeleted: vi.fn(), getDeletions: vi.fn(), del: vi.fn(), exportXlsx: vi.fn() }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), cacheData: vi.fn(), getCached: vi.fn(() => null) }))
vi.mock('./repositories', () => ({
  productRepository: {
    getAll: async () => [], update: vi.fn(), create: vi.fn(), receiveStock: vi.fn(), mergeDuplicates: vi.fn(),
    updateMany: h.updateMany, deleteProducts: h.deleteProducts, restoreDeleted: h.restoreDeleted, getDeletions: h.getDeletions, delete: h.del,
  },
}))
vi.mock('./inventoryExport', () => ({ exportInventoryXlsx: h.exportXlsx }))
vi.mock('../audit/repositories', () => ({ auditRepository: { recordExport: vi.fn(async () => ({ status: 'recorded' })) } }))

import Inventory from './Inventory.jsx'

const PRODUCTS = [
  { id: 'p1', name: 'Amoxil 500mg', category: 'Medicines', price: 1000, cost_price: 600, stock: 10, reorder_level: 5, list_on_carefind: true },
  { id: 'p2', name: 'Vitamin C', category: 'Supplements', price: 300, cost_price: 100, stock: 20, reorder_level: 5, list_on_carefind: true },
  { id: 'p3', name: 'Reviewed cream', category: 'Skincare', price: 4000, cost_price: 2000, stock: 3, reorder_level: 5, list_on_carefind: true },
]
const OWNER = { canEditPrice: true, canEditStock: true, canDelete: true, canExportReports: true }
const catalog = { status: 'ready', refreshing: false, stale: false, staleReason: null, loadedCount: 0, error: null, reload: vi.fn(async () => {}) }

let host, root, current
function Harness({ perms, role, initial }) {
  const [products, setProducts] = useState(initial)
  current = products
  return <MemoryRouter><Inventory brand={{ id: 'B1', plan: 'pro' }} products={products} setProducts={setProducts} catalog={catalog} role={role} perms={perms} /></MemoryRouter>
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const byText = (t) => btn((b) => b.textContent.trim() === t)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const type = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  await flush()
}
const dialog = () => document.querySelector('[role="dialog"]')
async function render({ perms = OWNER, role = 'Owner', initial = PRODUCTS } = {}) {
  await act(async () => { root.render(<Harness perms={perms} role={role} initial={initial} />) })
  await flush()
}
const tick = async (name) => click(document.querySelector(`input[aria-label="Select ${name}"]`))

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  h.updateMany.mockImplementation(async (_b, ids, updates) => ids.map((id) => ({ id, ...updates })))
  h.exportXlsx.mockImplementation(async (_rows, { beforeDownload }) => { await beforeDownload(); return true })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Inventory: mark and edit', () => {
  it('select products, edit them together, and the list shows the saved values', async () => {
    await render()
    await tick('Amoxil 500mg'); await tick('Vitamin C')
    expect(text()).toContain('2 selected')
    await click(byText('Edit selected'))
    await type(dialog().querySelector('input[list]'), 'Pharmacy')
    await type(dialog().querySelector('select[aria-label="Selling price: how to change it"]'), 'increase')
    await type(dialog().querySelector('input[aria-label="Selling price (%)"]'), '10')
    expect(dialog().textContent).toContain('2 of 2 products will change.')
    expect(dialog().textContent).toContain('Selling price ₦1,000 → ₦1,100')
    await click(btn((b) => b.textContent.startsWith('Update 2 products')))
    // A percentage gives each product its own price: one request each.
    expect(h.updateMany).toHaveBeenCalledWith('B1', ['p1'], { category: 'Pharmacy', price: 1100 })
    expect(h.updateMany).toHaveBeenCalledWith('B1', ['p2'], { category: 'Pharmacy', price: 330 })
    expect(dialog().textContent).toContain('2 products updated.')
    expect(current.find((p) => p.id === 'p2')).toMatchObject({ category: 'Pharmacy', price: 330 })
  })

  it('"Select all shown" marks the filtered list; failures are reported and can be retried', async () => {
    h.updateMany.mockRejectedValueOnce(new Error('Supabase error (500): down'))
    await render()
    await click(btn((b) => b.textContent.startsWith('Select all 3 shown')))
    expect(text()).toContain('3 selected')
    await click(byText('Edit selected'))
    await type(dialog().querySelectorAll('input')[1] /* reorder */, '8')
    await click(btn((b) => b.textContent.startsWith('Update 3 products')))
    expect(dialog().textContent).toContain('3 could not be updated.')
    await click(byText('Try the failed ones again'))
    expect(dialog().textContent).toContain('3 products updated.')
  })

  it('no bulk actions for a role that can neither edit nor delete', async () => {
    await render({ perms: {}, role: 'Cashier' })
    expect(document.querySelector('input[aria-label="Select Amoxil 500mg"]')).toBeNull()
    expect(text()).not.toContain('Delete all')
  })
})

describe('Inventory: delete selected', () => {
  it('deletes what the database deleted, lists what was kept and why, and offers Undo', async () => {
    h.deleteProducts.mockResolvedValue({ deletion_id: 'd1', deleted: 1, not_found: 0, kept: [{ id: 'p3', name: 'Reviewed cream', reasons: ['reviews'] }] })
    h.restoreDeleted.mockResolvedValue({ restored: 1, skipped_name_taken: 0, skipped_already_back: 0 })
    await render()
    await tick('Amoxil 500mg'); await tick('Reviewed cream')
    await click(byText('Delete selected'))
    expect(dialog().textContent).toContain('This deletes the 2 marked products.')
    await click(btn((b) => b.textContent.trim() === 'Delete 2' && b.closest('[role="dialog"]')))
    expect(h.deleteProducts).toHaveBeenCalledWith('B1', { ids: ['p1', 'p3'] })
    expect(dialog().textContent).toContain('1 product deleted.')
    expect(dialog().textContent).toContain('Reviewed cream: has customer reviews')
    expect(current.map((p) => p.id)).toEqual(['p2', 'p3'])
    await click(byText('Undo'))
    expect(h.restoreDeleted).toHaveBeenCalledWith('B1', 'd1')
    expect(catalog.reload).toHaveBeenCalled()
  })
})

describe('Inventory: delete all & re-upload', () => {
  it('owner only: backup step, typed confirmation, then delete everything and go to upload', async () => {
    h.deleteProducts.mockResolvedValue({ deletion_id: 'd9', deleted: 3, not_found: 0, kept: [] })
    await render()
    await click(btn((b) => b.textContent.includes('Delete all & re-upload')))
    const go = () => btn((b) => b.textContent.trim() === 'Delete all products' && b.closest('[role="dialog"]'))
    expect(go().disabled).toBe(true)
    await click(byText('Download Excel copy'))
    expect(h.exportXlsx).toHaveBeenCalledWith(PRODUCTS, expect.anything())
    await type(dialog().querySelector('input[autocomplete="off"]'), 'delete all products')
    expect(go().disabled).toBe(true)
    await type(dialog().querySelector('input[autocomplete="off"]'), 'DELETE ALL PRODUCTS')
    expect(go().disabled).toBe(false)
    await click(go())
    expect(h.deleteProducts).toHaveBeenCalledWith('B1', { all: true, confirm: 'DELETE ALL PRODUCTS' })
    expect(current).toEqual([])
    await click(byText('Upload your new list'))
    expect(text()).toContain('Upload Products from Excel / CSV')
  })

  it('a manager who may delete can delete selected products but not everything', async () => {
    await render({ role: 'Manager', perms: { canDelete: true } })
    expect(text()).not.toContain('Delete all & re-upload')
    await tick('Vitamin C')
    expect(byText('Delete selected')).toBeTruthy()
  })
})

describe('Inventory: single delete and Recently deleted', () => {
  it('Del goes through the safe delete: a linked product is kept with the reason', async () => {
    h.deleteProducts.mockResolvedValue({ deletion_id: null, deleted: 0, not_found: 0, kept: [{ id: 'p3', name: 'Reviewed cream', reasons: ['shop_listing'] }] })
    await render()
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Reviewed cream'))
    await click([...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Del'))
    await click(btn((b) => b.textContent.trim() === 'Delete' && b.closest('[role="dialog"], [role="alertdialog"]')))
    expect(text()).toContain('"Reviewed cream" was kept: it is listed in your online shop.')
    expect(current).toHaveLength(3)
  })

  it('before the update is installed, Del falls back to the previous delete', async () => {
    h.deleteProducts.mockRejectedValue(Object.assign(new Error('needs update'), { code: 'DELETE_UNAVAILABLE' }))
    await render()
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Vitamin C'))
    await click([...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Del'))
    await click(btn((b) => b.textContent.trim() === 'Delete' && b.closest('[role="dialog"], [role="alertdialog"]')))
    expect(h.del).toHaveBeenCalledWith('p2', 'B1')
    expect(current.map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('Recently deleted lists deletions and restores one', async () => {
    h.getDeletions.mockResolvedValue([{ deletion_id: 'd1', deleted_at: '2026-11-10T09:00:00Z', by: 'Ada', all: true, count: 120, restored: 0, names: ['A', 'B', 'C'] }])
    h.restoreDeleted.mockResolvedValue({ restored: 118, skipped_name_taken: 2, skipped_already_back: 0 })
    await render()
    await click(btn((b) => b.textContent.includes('Recently deleted')))
    expect(dialog().textContent).toContain('All products cleared')
    await click(btn((b) => b.getAttribute('aria-label') === 'Restore 120 deleted products'))
    expect(h.restoreDeleted).toHaveBeenCalledWith('B1', 'd1')
    expect(text()).toContain('118 products restored; 2 skipped because a product with the same name exists now.')
  })
})
