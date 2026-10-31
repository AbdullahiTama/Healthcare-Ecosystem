// Editing a recorded purchase: the form is filled from the purchase and from
// get_purchase_for_edit, limits are explained before saving, the save sends
// exactly what edit_purchase needs, and refusals are shown in plain words.
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({
  getById: vi.fn(), getForEdit: vi.fn(), edit: vi.fn(), getSupplierStats: vi.fn(async () => []), getSupplierBalances: vi.fn(async () => []),
  getProductStats: vi.fn(async () => []), getPayments: vi.fn(async () => []), getEditHistory: vi.fn(async () => []),
}))
vi.mock('../repositories', () => ({ purchaseRepository: repo }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))

import EditPurchaseModal from '../EditPurchase'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const AMOXIL = { id: 'p1', name: 'Amoxil 500mg', category: 'Medicines', price: 1500, cost_price: 800, stock: 3, barcode: '6001' }
const PANADOL = { id: 'p2', name: 'Panadol', category: 'Medicines', price: 200, cost_price: 100, stock: 40 }
const PURCHASE = { id: 'pur1', supplier_name: 'MedSupply Ltd', supply_date: '2026-10-30', due_date: '', amount_paid: 5000, total_cost: 13000, balance: 8000, notes: 'INV-9', edit_count: 1, created_at: '2026-10-30T10:00:00' }
const LINES = [
  { id: 'l1', product_id: 'p1', name: 'Amoxil 500mg', qty: 10, cost: 800, sell: null, batch: null, expiry: null, barcode: '6001', cat: 'Medicines', received: 10, product_stock: 3, min_qty: 7, locked: false },
  { id: 'l2', product_id: 'p2', name: 'Panadol', qty: 50, cost: 100, sell: null, batch: null, expiry: null, barcode: null, cat: 'Medicines', received: 50, product_stock: 60, min_qty: 1, locked: false },
]

let host, root, qc, toast, onClose, onSaved, setProducts
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
const field = (line, name) => document.querySelectorAll(`[id^="epi-"][id$="-${name}"]`)[line]
async function type(el, value) {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function mount({ products = [AMOXIL, PANADOL] } = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(
    <QueryClientProvider client={qc}>
      <EditPurchaseModal brand={{ id: 'B1' }} purchase={PURCHASE} inventory={products} inventoryStatus='ready' setProducts={setProducts}
        staffName='Ada' showToast={toast} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>))
  await flush(); await flush()
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  toast = vi.fn(); onClose = vi.fn(); onSaved = vi.fn(); setProducts = vi.fn()
  repo.getById.mockReset().mockResolvedValue(PURCHASE)
  repo.getForEdit.mockReset().mockResolvedValue({ purchase_id: 'pur1', items: LINES, itemised: true, can_edit: true })
  repo.edit.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Edit purchase', () => {
  it('fills the form from the purchase and explains how far a line can go down', async () => {
    await mount()
    expect(document.querySelector('#edit-purchase-supplier').value).toBe('MedSupply Ltd')
    expect(field(0, 'qty').value).toBe('10')
    expect(field(1, 'cost').value).toBe('100')
    expect(document.body.textContent).toContain('7 of the 10 from this purchase are already sold: the lowest quantity is 7.')
    expect(document.body.textContent).toContain('Edited 1 time before')
    // Units already sold: the line cannot be removed.
    expect(document.querySelector('[aria-label="Remove item 1 (Amoxil 500mg)"]').disabled).toBe(true)
    expect(document.querySelector('[aria-label="Remove item 2 (Panadol)"]').disabled).toBe(false)
  })

  it('a quantity below what is left, or no reason, blocks the save with the reason why', async () => {
    await mount()
    await type(field(0, 'qty'), '5')
    await act(async () => button('Save changes').click())
    await flush()
    expect(repo.edit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Line 1 needs attention')
    expect(document.body.textContent).toContain('Lowest is 7: the rest is already sold')
    await type(field(0, 'qty'), '12')
    await act(async () => button('Save changes').click())
    await flush()
    expect(repo.edit).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Say why the purchase is being changed')
  })

  it('saves through edit_purchase with the versions loaded, leaves the amount paid alone when untouched, and updates Inventory', async () => {
    repo.edit.mockResolvedValue({
      unchanged: false, created_products: 0,
      stock_changes: [{ product_id: 'p1', name: 'Amoxil 500mg', change: 2 }],
      products: [{ ...AMOXIL, stock: 5 }],
      purchase: { ...PURCHASE, total_cost: 14600, edit_count: 2 },
    })
    await mount()
    await type(field(0, 'qty'), '12')
    await type(field(1, 'cost'), '120')
    await type(document.querySelector('#edit-purchase-reason'), 'Invoice said 12')
    await act(async () => button('Save changes').click())
    await flush()
    expect(repo.edit).toHaveBeenCalledTimes(1)
    const [id, edit] = repo.edit.mock.calls[0]
    expect(id).toBe('pur1')
    expect(edit).toMatchObject({
      supplier: 'MedSupply Ltd', supplyDate: '2026-10-30', dueDate: null, notes: 'INV-9', reason: 'Invoice said 12', staffName: 'Ada',
      amountPaid: null, expectedEditCount: 1, expectedAmountPaid: 5000,
    })
    expect(edit.items).toEqual([
      { id: 'l1', product_id: 'p1', name: 'Amoxil 500mg', qty: 12, cost: 800, sell: null, batch: null, expiry: null, barcode: '6001', cat: 'Medicines' },
      { id: 'l2', product_id: 'p2', name: 'Panadol', qty: 50, cost: 120, sell: null, batch: null, expiry: null, barcode: null, cat: 'Medicines' },
    ])
    expect(setProducts).toHaveBeenCalled()
    expect(setProducts.mock.calls[0][0]([AMOXIL, PANADOL]).find((p) => p.id === 'p1').stock).toBe(5)
    expect(toast).toHaveBeenCalledWith('Purchase updated. Stock: +2 Amoxil 500mg.', { type: 'success', duration: 7000 })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a changed amount paid is sent; more than the total is refused before saving', async () => {
    repo.edit.mockResolvedValue({ unchanged: false, stock_changes: [], products: [], purchase: PURCHASE })
    await mount()
    await type(document.querySelector('#edit-purchase-amount-paid'), '99999')
    await type(document.querySelector('#edit-purchase-reason'), 'Paid figure was wrong')
    expect(document.body.textContent).toContain('More than the total')
    await act(async () => button('Save changes').click())
    await flush()
    expect(repo.edit).not.toHaveBeenCalled()
    await type(document.querySelector('#edit-purchase-amount-paid'), '4000')
    await act(async () => button('Save changes').click())
    await flush()
    expect(repo.edit.mock.calls[0][1].amountPaid).toBe(4000)
  })

  it("shows the database's refusal in plain words and keeps the edits", async () => {
    repo.edit.mockRejectedValue(new Error('Supabase error (400): Line 1 (Amoxil 500mg): only 3 in stock now, so this purchase cannot take back 4 units. The lowest quantity you can set is 7.'))
    await mount()
    await type(field(0, 'qty'), '8')
    await type(document.querySelector('#edit-purchase-reason'), 'Correction')
    await act(async () => button('Save changes').click())
    await flush()
    const alert = document.querySelector('[role="alert"]')
    expect(alert.textContent).toBe('Line 1 (Amoxil 500mg): only 3 in stock now, so this purchase cannot take back 4 units. The lowest quantity you can set is 7.')
    expect(field(0, 'qty').value).toBe('8')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a network failure is not shown as a refusal', async () => {
    repo.edit.mockRejectedValue(new Error('Failed to fetch'))
    await mount()
    await type(document.querySelector('#edit-purchase-reason'), 'Correction')
    await type(field(1, 'cost'), '101')
    await act(async () => button('Save changes').click())
    await flush()
    expect(document.querySelector('[role="alert"]').textContent).toContain("couldn't save the changes")
  })

  it('a line recorded before stock tracking keeps its product and quantity', async () => {
    repo.getForEdit.mockResolvedValue({ purchase_id: 'pur1', itemised: false, can_edit: true, items: [
      { id: 'legacy-1', product_id: null, name: 'Gauze, Plaster', qty: 20, cost: 25, received: 0, ledger_base: 20, locked: true, min_qty: null },
    ] })
    await mount()
    expect(field(0, 'name').readOnly).toBe(true)
    expect(field(0, 'qty').readOnly).toBe(true)
    expect(field(0, 'cost').readOnly).toBe(false)
    expect(document.body.textContent).toContain('Recorded before stock tracking')
  })

  it('without the permission, nothing can be changed', async () => {
    repo.getForEdit.mockResolvedValue({ purchase_id: 'pur1', items: LINES, itemised: true, can_edit: false })
    await mount()
    expect(document.body.textContent).toContain('You are not allowed to edit purchases')
    expect(button('Save changes')).toBeUndefined()
  })

  it('before the database update, says editing is not available yet', async () => {
    repo.getForEdit.mockRejectedValue(new Error('Supabase error (404): Could not find the function public.get_purchase_for_edit(p_purchase_id) in the schema cache'))
    await mount()
    expect(document.body.textContent).toContain('Editing purchases becomes available once the latest database update is applied')
  })

  it('closing with unsaved changes asks first', async () => {
    await mount()
    await type(field(1, 'cost'), '130')
    await act(async () => button('Cancel').click())
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Discard your changes?')
    await act(async () => button('Discard changes').click())
    expect(onClose).toHaveBeenCalled()
  })
})
