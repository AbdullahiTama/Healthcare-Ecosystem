import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getSupplierBalances: vi.fn(), getBySupplier: vi.fn(), getPayments: vi.fn(), recordPayment: vi.fn() }))
vi.mock('./repositories', () => ({ purchaseRepository: repo }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))

import { SupplierBalances, PurchasePaymentModal, purchaseStatus } from './SupplierPayments.jsx'

const BRAND = { id: 'biz-1' }
let host, root, qc, toast, onPaid
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label))
function type(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
async function mount(ui) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>))
  await flush(); await flush()
}

const purchase = { id: 'p1', supplier_name: 'Emzor Ltd', product_name: 'Amoxil', total_cost: 10000, amount_paid: 4000, balance: 6000, status: 'pending', supply_date: '2026-10-01' }

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  toast = vi.fn(); onPaid = vi.fn()
  for (const f of Object.values(repo)) f.mockReset()
  repo.getSupplierBalances.mockResolvedValue([
    { supplier_key: 'emzor ltd', supplier_name: 'Emzor Ltd', purchase_count: 2, open_count: 1, total_cost: 12000, amount_paid: 6000, balance: 6000 },
    { supplier_key: 'fidson', supplier_name: 'Fidson', purchase_count: 1, open_count: 0, total_cost: 3000, amount_paid: 3000, balance: 0 },
  ])
  repo.getBySupplier.mockResolvedValue([purchase, { ...purchase, id: 'p0', balance: 0, amount_paid: 2000, total_cost: 2000, status: 'paid' }])
  repo.getPayments.mockResolvedValue([{ id: 'x1', amount: 4000, method: 'Other', kind: 'at_purchase', balance_after: 6000, created_at: '2026-10-01T09:00:00Z' }])
})
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); root = undefined; host = undefined; qc.clear() })

describe('purchaseStatus', () => {
  it('labels unpaid, part paid and paid', () => {
    expect(purchaseStatus({ balance: 100, amount_paid: 0 }).label).toBe('Unpaid')
    expect(purchaseStatus({ balance: 100, amount_paid: 50 }).label).toBe('Part paid')
    expect(purchaseStatus({ balance: 0, amount_paid: 150 }).label).toBe('Paid')
  })
})

describe('Suppliers & payments', () => {
  it('lists suppliers with what is owed, searchable, and opens a supplier with unpaid purchases and history', async () => {
    await mount(<SupplierBalances brand={BRAND} staffName='Ada' showToast={toast} onPaid={onPaid} />)
    expect(text()).toContain('2 suppliers')
    expect(text()).toContain('₦6,000 owed')
    await act(async () => type(host.querySelector('input[type="search"]'), 'fid'))
    expect(text()).toContain('1 supplier')
    await act(async () => type(host.querySelector('input[type="search"]'), ''))
    await act(async () => button('Payments').click())
    await flush(); await flush()
    expect(repo.getBySupplier).toHaveBeenCalledWith('biz-1', 'emzor ltd')
    expect(repo.getPayments).toHaveBeenCalledWith('biz-1', { supplierKey: 'emzor ltd' })
    expect(text()).toContain('Unpaid purchases')
    expect(text()).toContain('Paid with the purchase')
  })

  it('records a partial supplier payment with date and note, then refreshes', async () => {
    repo.recordPayment.mockResolvedValue({ amount: 2500, amount_paid: 6500, balance: 3500, status: 'partial' })
    const onClose = vi.fn()
    await mount(<PurchasePaymentModal brand={BRAND} purchase={purchase} staffName='Ada' showToast={toast} onPaid={onPaid} onClose={onClose} />)
    await act(async () => type(document.querySelector('#purchase-p1-amount'), '2500'))
    await act(async () => type(document.querySelector('#purchase-p1-method'), 'Cheque'))
    await act(async () => type(document.querySelector('#purchase-p1-date'), '2026-10-20'))
    await act(async () => type(document.querySelector('#purchase-p1-note'), 'chq 0012'))
    await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush(); await flush()
    expect(repo.recordPayment).toHaveBeenCalledWith('p1', { amount: 2500, method: 'Cheque', paidOn: '2026-10-20', note: 'chq 0012', staffName: 'Ada' })
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('₦3,500 still owed'), { type: 'success' })
    expect(onPaid).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a fully paid purchase shows its history and no payment form', async () => {
    await mount(<PurchasePaymentModal brand={BRAND} purchase={{ ...purchase, balance: 0, amount_paid: 10000, status: 'paid' }} showToast={toast} onClose={() => {}} />)
    expect(text()).toContain('This purchase is fully paid.')
    expect(document.querySelector('form')).toBeNull()
    expect(text()).toContain('Payments on this purchase')
  })
})
