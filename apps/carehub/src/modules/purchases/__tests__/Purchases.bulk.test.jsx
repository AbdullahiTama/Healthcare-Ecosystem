// Purchases bulk actions: mark purchases, edit their headers together (one reason, through edit_purchase on the
// server), delete them (stock taken back; purchases whose stock was sold are kept with why), Undo and Recently
// deleted. Permissions: "Edit purchases" to edit; also a delete role to delete.
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({
  getPage: vi.fn(), getTotals: vi.fn(async () => [{ purchase_count: 2, total_paid: 0, total_owed: 0 }]),
  getSupplierStats: vi.fn(async () => [{ supplier_name: 'MedSupply Ltd', supplier_key: 'medsupply ltd' }]), getSupplierBalances: vi.fn(async () => []), getProductStats: vi.fn(async () => []),
  bulkEdit: vi.fn(), deleteMany: vi.fn(), restoreDeleted: vi.fn(), getDeletions: vi.fn(),
}))
vi.mock('../repositories', () => ({ purchaseRepository: repo }))
vi.mock('../../inventory/repositories', () => ({ productRepository: {} }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../debts/repositories', () => ({ debtRepository: {} }))
vi.mock('../../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-10' }))

import Purchases from '../Purchases'

let db, host, root, qc, reload
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const type = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  await flush()
}
const dialog = () => document.querySelector('[role="dialog"]')
const text = () => document.body.textContent
const box = (supplier) => document.querySelector(`input[aria-label^="Select purchase from ${supplier}"]`)
const input = (labelText) => { const l = [...dialog().querySelectorAll('label')].find((x) => x.textContent.startsWith(labelText)); return document.getElementById(l.htmlFor) }
async function mount(perms = {}, role = 'Owner') {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Purchases brand={{ id: 'B1' }} role={role} perms={perms} products={[]} setProducts={() => {}} catalog={{ status: 'ready', reload }} staffName='Ada' /></QueryClientProvider>) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  reload = vi.fn()
  db = [
    { id: 'p1', supplier_name: 'MedSupply Ltd', product_name: 'Amoxicillin, Paracetamol', quantity: 60, total_cost: 1800, amount_paid: 1200, balance: 600, supply_date: '2026-10-30', due_date: '', notes: '', status: 'partial', edit_count: 0 },
    { id: 'p2', supplier_name: 'ORS Depot', product_name: 'ORS sachet', quantity: 20, total_cost: 600, amount_paid: 600, balance: 0, supply_date: '2026-10-28', due_date: '', notes: '', status: 'paid', edit_count: 0 },
  ]
  repo.getPage.mockImplementation(async () => db.map((x) => ({ ...x })))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Purchases: mark and edit', () => {
  it('renames the supplier and sets a due date on both with one reason; skipped ones are explained', async () => {
    repo.bulkEdit.mockImplementation(async (_b, ids, updates) => ({
      updated: 1, unchanged: 0, failed: [],
      rows: [{ ...db[0], ...updates, edit_count: 1 }],
      skipped: [{ id: 'p2', name: 'ORS Depot', reason: 'stock_differs' }],
    }))
    await mount()
    await click(box('MedSupply Ltd')); await click(box('ORS Depot'))
    expect(text()).toContain('2 selected')
    await click(btn((b) => b.textContent.includes('Edit selected')))
    expect(dialog().textContent).toContain('2 marked, ₦2,400 in all.')
    await type(input('Supplier'), 'MedSupply Nigeria Ltd')
    await type(input('Due date'), 'set')
    await type(input('New due date'), '2026-12-31')
    expect(btn((b) => b.textContent.startsWith('Update ')).disabled).toBe(true)
    expect(dialog().textContent).toContain('Say why these purchases are being changed')
    await type(input('Reason for the change'), 'Supplier renamed')
    expect(dialog().textContent).toContain('2 of 2 purchases will change.')
    await click(btn((b) => b.textContent.startsWith('Update 2 purchases')))
    expect(repo.bulkEdit).toHaveBeenCalledTimes(1)
    expect(repo.bulkEdit).toHaveBeenCalledWith('B1', ['p1', 'p2'], { supplier_name: 'MedSupply Nigeria Ltd', due_date: '2026-12-31' }, { reason: 'Supplier renamed', staffName: 'Ada' })
    expect(dialog().textContent).toContain('1 purchase updated.')
    expect(dialog().textContent).toContain('1 skipped, because changing them would also change stock: ORS Depot · 2026-10-28 (its stock in Inventory differs from its quantities)')
    await click(btn((b) => b.textContent.trim() === 'Done'))
    expect(box('MedSupply Nigeria Ltd')).toBeTruthy()
  })

  it('without "Edit purchases" nothing can be marked; with it but no delete permission, edit only', async () => {
    await mount({}, 'Cashier')
    expect(box('MedSupply Ltd')).toBeNull()
    await act(async () => root.unmount()); host.remove()
    await mount({ canEditPurchases: true }, 'Manager')
    await click(box('MedSupply Ltd'))
    expect(btn((b) => b.textContent.includes('Edit selected'))).toBeTruthy()
    expect(btn((b) => b.textContent.includes('Delete selected'))).toBeUndefined()
    expect(text()).not.toContain('Recently deleted')
  })
})

describe('Purchases: delete selected and restore', () => {
  it('deletes the purchase whose stock can be taken back, keeps the sold one with why, refreshes stock, Undo restores', async () => {
    repo.deleteMany.mockImplementation(async () => {
      db = db.filter((x) => x.id !== 'p1')
      return { deletion_id: 'del1', deleted: 1, kept: [{ id: 'p2', name: 'ORS Depot', reasons: ['stock_used'], product: 'ORS sachet', ref: '2026-10-28' }], not_found: 0 }
    })
    repo.restoreDeleted.mockResolvedValue({ restored: 1, skipped_already_back: 0, skipped_stock: 0, skipped: [] })
    await mount({ canEditPurchases: true, canDelete: true }, 'Manager')
    await click(box('MedSupply Ltd')); await click(box('ORS Depot'))
    await click(btn((b) => b.textContent.includes('Delete selected')))
    expect(dialog().textContent).toContain('stock is taken back')
    await click(btn((b) => b.textContent.trim() === 'Delete 2' && b.closest('[role="dialog"]')))
    expect(repo.deleteMany).toHaveBeenCalledWith('B1', ['p1', 'p2'])
    expect(dialog().textContent).toContain('1 purchase deleted.')
    expect(dialog().textContent).toContain('ORS Depot: some units (ORS sachet) were sold or moved since')
    expect(reload).toHaveBeenCalled()
    await click(btn((b) => b.textContent.trim() === 'Undo'))
    expect(repo.restoreDeleted).toHaveBeenCalledWith('B1', 'del1')
    expect(dialog().textContent).toContain('1 purchase restored.')
  })

  it('Recently deleted lists purchase deletions and says when stock could not go back', async () => {
    repo.getDeletions.mockResolvedValue([{ deletion_id: 'del1', deleted_at: '2026-11-10T09:00:00Z', by: 'Ada', all: false, count: 2, restored: 0, names: ['MedSupply Ltd', 'Cold Chain'] }])
    repo.restoreDeleted.mockResolvedValue({ restored: 1, skipped_already_back: 0, skipped_stock: 1, skipped: [{ id: 'x', name: 'Cold Chain', product: 'Insulin' }] })
    await mount()
    await click(btn((b) => b.textContent.includes('Recently deleted')))
    expect(dialog().textContent).toContain('2 purchases deleted')
    await click(btn((b) => b.getAttribute('aria-label') === 'Restore 2 deleted purchases'))
    expect(repo.restoreDeleted).toHaveBeenCalledWith('B1', 'del1')
    expect(text()).toContain('1 purchase restored; 1 not restored because a product or batch they stocked is gone.')
    expect(text()).toContain('Cold Chain (Insulin)')
  })
})
