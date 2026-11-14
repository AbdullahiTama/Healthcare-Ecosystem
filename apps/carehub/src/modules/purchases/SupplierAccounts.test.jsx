// Purchases › Supplier summary: supplier accounts from purchases plus supply records, one payment on the account,
// supply and payment histories, supply records without products, and the fallback before the database update.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getSupplierAccounts: vi.fn(), getSupplierActivity: vi.fn(), recordSupplierPayment: vi.fn(), getPayments: vi.fn(), getById: vi.fn(), recordPayment: vi.fn() }))
const debts = vi.hoisted(() => ({ create: vi.fn(), getPayments: vi.fn(), recordPayment: vi.fn() }))
vi.mock('./repositories', () => ({ purchaseRepository: repo }))
vi.mock('../debts/repositories', () => ({ debtRepository: debts }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))

import SupplierAccounts from './SupplierAccounts.jsx'

const ACCOUNTS = [
  { supplier_key: 'emzor ltd', supplier_name: 'Emzor Ltd', purchase_count: 2, supply_count: 1, supplied_total: 21000, paid_total: 1000, balance: 20000, open_count: 3, mismatch_count: 0, last_supply_at: '2026-03-05' },
  { supplier_key: 'fidson', supplier_name: 'Fidson', purchase_count: 1, supply_count: 0, supplied_total: 2000, paid_total: 2000, balance: 0, open_count: 0, mismatch_count: 0, last_supply_at: '2026-03-06' },
]
const ACTIVITY = {
  supplies: [
    { kind: 'purchase', id: 'p2', party_name: 'Emzor Ltd', date: '2026-03-05', created_at: '2026-03-05', description: 'Amoxicillin', lines: 2, amount: 4000, paid: 1000, balance: 3000, status: 'partial' },
    { kind: 'supply', id: 'd2', party_name: 'Emzor Ltd', date: '2026-02-01', created_at: '2026-02-01', description: 'Opening balance', amount: 7000, paid: 0, balance: 7000, status: 'pending' },
  ],
  payments: [
    { id: 'x1', source: 'purchase', amount: 10000, method: 'Transfer', kind: 'payment', paid_on: '2026-03-10', allocation_id: 'a1', note: 'March cheque', balance_after: 0 },
    { id: 'x2', source: 'supply', amount: 2500, method: 'Transfer', kind: 'payment', paid_on: '2026-03-10', allocation_id: 'a1', balance_after: 4500 },
  ],
}
let host, root, qc, toast
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const dialog = () => document.querySelector('[role="dialog"]')
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }
function type(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
async function mount(props = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}><SupplierAccounts brand={{ id: 'biz' }} role='Owner' perms={{}} staffName='Ada' showToast={toast} onPaid={vi.fn()} {...props} /></QueryClientProvider>))
  await flush(); await flush()
}
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  toast = vi.fn()
  for (const f of [...Object.values(repo), ...Object.values(debts)]) f.mockReset()
  repo.getSupplierAccounts.mockResolvedValue({ available: true, rows: ACCOUNTS })
  repo.getSupplierActivity.mockResolvedValue(ACTIVITY)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; qc.clear() })

describe('Supplier summary', () => {
  it('lists each supplier\'s supplied, paid and outstanding, with totals that add up, searchable', async () => {
    await mount()
    expect(text()).toContain('Total supplied / owed₦23,000')
    expect(text()).toContain('Paid₦3,000')
    expect(text()).toContain('Outstanding₦20,000')
    expect(text()).toContain('2 purchases · 1 supply record · 3 open')
    await act(async () => type(host.querySelector('input[type="search"]'), 'fid'))
    expect(text()).toContain('1 supplier · ₦0 owed')
    await act(async () => type(host.querySelector('input[type="search"]'), ''))
    await act(async () => { host.querySelector('input[type="checkbox"]').click() })
    expect(text()).toContain('1 supplier · ₦20,000 owed')
  })

  it('opens an account with its supplies and one payment shown as one, and records an account payment', async () => {
    repo.recordSupplierPayment.mockResolvedValue({ amount: 5000, allocations: [{ kind: 'purchase', id: 'p1' }, { kind: 'supply', id: 'd2' }], balance: 15000 })
    await mount()
    await click(btn((b) => b.getAttribute('aria-label') === "Open Emzor Ltd's account"))
    expect(repo.getSupplierActivity).toHaveBeenCalledWith('biz', 'emzor ltd')
    expect(dialog().textContent).toContain('Supply history (2)')
    expect(dialog().textContent).toContain('Opening balance')
    expect(dialog().textContent).toContain('Supply record')
    expect(dialog().textContent).toContain('2 lines')
    await click(btn((b) => b.textContent.startsWith('Payment history'), dialog()))
    expect(dialog().textContent).toContain('₦12,500')
    expect(dialog().textContent).toContain('one payment applied to 2 items, oldest first')
    await act(async () => type(dialog().querySelector('#supplier-account-amount'), '5000'))
    await act(async () => { dialog().querySelector('form[aria-label="Record a payment"]').requestSubmit() })
    await flush(); await flush()
    expect(repo.recordSupplierPayment).toHaveBeenCalledWith('biz', 'emzor ltd', expect.objectContaining({ amount: 5000, method: 'Transfer', staffName: 'Ada' }))
    expect(toast).toHaveBeenCalledWith('₦5,000 paid to Emzor Ltd, applied to 2 items. ₦15,000 still owed.', { type: 'success' })
  })

  it('a supply record (no products) is added to an existing supplier\'s account, never a second spelling', async () => {
    debts.create.mockResolvedValue([{ id: 'new' }])
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Supply record'))
    await act(async () => type(document.getElementById('supply-supplier'), 'EMZOR LTD'))
    expect(dialog().textContent).toContain("Adds to Emzor Ltd's account.")
    await act(async () => type(document.getElementById('supply-amount'), '3000'))
    await act(async () => type(document.getElementById('supply-paid'), '500'))
    await click(btn((b) => b.textContent === 'Save', dialog()))
    expect(debts.create).toHaveBeenCalledWith('biz', expect.objectContaining({ direction: 'we_owe', party_name: 'Emzor Ltd', amount: 3000, amount_paid: 500, balance: 2500, source: 'manual' }))
  })

  it('warns about a near-duplicate supplier name and refuses impossible amounts', async () => {
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Supply record'))
    await act(async () => type(document.getElementById('supply-supplier'), 'Emzor Limited'))
    expect(dialog().textContent).toContain('Did you mean Emzor Ltd?')
    await act(async () => type(document.getElementById('supply-amount'), '100'))
    await act(async () => type(document.getElementById('supply-paid'), '200'))
    await click(btn((b) => b.textContent === 'Save', dialog()))
    expect(debts.create).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('between 0 and the amount')
  })

  it('before the database update: purchase totals only, no account payment, supply records or import', async () => {
    repo.getSupplierAccounts.mockResolvedValue({ available: false, rows: [{ ...ACCOUNTS[0], supply_count: 0 }] })
    await mount()
    expect(text()).toContain('become available once the latest database update is applied')
    expect(btn((b) => b.textContent.trim() === 'Import')).toBeUndefined()
    await click(btn((b) => b.getAttribute('aria-label') === "Open Emzor Ltd's account"))
    expect(dialog().querySelector('form[aria-label="Record a payment"]')).toBeNull()
    expect(btn((b) => b.getAttribute('aria-label') === 'Pay purchase: Amoxicillin', dialog())).toBeTruthy()
  })

  it('a failed load can be retried; no suppliers says how to start', async () => {
    repo.getSupplierAccounts.mockRejectedValueOnce(new Error('network'))
    await mount()
    expect(text()).toContain("We couldn't load your supplier accounts.")
    await act(async () => root.unmount()); host.remove(); qc.clear()
    repo.getSupplierAccounts.mockResolvedValue({ available: true, rows: [] })
    await mount()
    expect(text()).toContain('No suppliers yet.')
  })
})
