// The figures above the Purchases list describe exactly the purchases listed (same period, supplier, search), and
// History & analytics shares the period and supplier, so the Purchases total and the Purchase Summary agree.
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({
  getPage: vi.fn(), getTotals: vi.fn(),
  getSummary: vi.fn(async () => ({ purchase_count: 2, line_count: 3, units: 10, total_spent: 8000, amount_paid: 1000, balance: 7000, supplier_count: 1, product_count: 2 })),
  getSupplierStats: vi.fn(async () => [{ supplier_key: 'emzor', supplier_name: 'Emzor', purchase_count: 1, total_spent: 8000 }]), getSupplierBalances: vi.fn(async () => []), getSuppliers: vi.fn(async () => ({ available: true, rows: [{ supplier_name: 'Emzor' }] })),
  saveSupplierPhone: vi.fn(), getProductStats: vi.fn(async () => []), getHistory: vi.fn(async () => []), getAllPages: vi.fn(async () => []),
}))
vi.mock('../repositories', () => ({ purchaseRepository: repo }))
vi.mock('../../inventory/repositories', () => ({ productRepository: {} }))
vi.mock('../../debts/repositories', () => ({ debtRepository: {} }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-19' }))

import Purchases, { totalAmount } from '../Purchases'

let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush() }
const text = () => host.textContent
const card = (label) => [...host.querySelectorAll('div')].find((d) => d.textContent.startsWith(label) && d.textContent.length < label.length + 60)
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Purchases brand={{ id: 'B1' }} role='Owner' perms={{}} products={[]} setProducts={vi.fn()} catalog={{ status: 'ready', reload: vi.fn() }} staffName='Ada' /></QueryClientProvider>) })
  await settle()
}
async function choose(select, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}
const supplierSelect = () => [...host.querySelectorAll('label')].find((l) => l.textContent.startsWith('Supplier'))?.querySelector('select')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  repo.getPage.mockResolvedValue([{ id: 'p1', supplier_name: 'Emzor', product_name: 'Paracetamol', quantity: 100, total_cost: 8000, amount_paid: 1000, balance: 7000, supply_date: '2026-11-03', status: 'partial' }])
  repo.getTotals.mockResolvedValue([{ purchase_count: 1, total_amount: 8000, total_paid: 1000, total_owed: 7000 }])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Purchases figures follow the list', () => {
  it('shows the Total Amount (paid + owed) for the purchases listed', async () => {
    await mount()
    expect(repo.getTotals).toHaveBeenCalledWith('B1', { search: '', from: null, to: null, supplierKey: '' })
    expect(card('Total Amount').textContent).toMatch(/₦8,000/)
    expect(card('Total Purchases').textContent).toMatch(/All time/)
  })

  it('narrowing the list to a supplier narrows the figures with it', async () => {
    await mount()
    await choose(supplierSelect(), 'emzor')
    expect(repo.getPage).toHaveBeenLastCalledWith('B1', expect.objectContaining({ supplierKey: 'emzor' }))
    expect(repo.getTotals).toHaveBeenLastCalledWith('B1', expect.objectContaining({ supplierKey: 'emzor' }))
    expect(card('Total Purchases').textContent).toMatch(/Emzor/)
  })

  it('before the database update, filtered figures fall back to all purchases and say so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    repo.getTotals.mockImplementation(async (_b, f) => {
      if (f && f.supplierKey) throw new Error('Could not find the function public.get_purchase_totals(p_business_id, p_supplier_key) in the schema cache')
      return [{ purchase_count: 3, total_paid: 1000, total_owed: 9000 }]
    })
    await mount()
    await choose(supplierSelect(), 'emzor')
    expect(card('Total Purchases').textContent).toMatch(/All purchases/)
    expect(card('Total Amount').textContent).toMatch(/₦10,000/)   // paid + owed when the old function has no total
    warn.mockRestore()
  })

  it('totalAmount: the stored total, else paid + owed', () => {
    expect(totalAmount({ total_amount: 5, total_paid: 1, total_owed: 1 })).toBe(5)
    expect(totalAmount({ total_paid: 1, total_owed: 2 })).toBe(3)
    expect(totalAmount(null)).toBe(0)
  })
})

describe('History & analytics shares the selection', () => {
  it('opens on the same period and supplier as the Purchases tab, and a change there applies back', async () => {
    await mount()
    await choose(supplierSelect(), 'emzor')
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'History & analytics')
    await act(async () => { tab.click() }); await settle()
    expect(supplierSelect().value).toBe('emzor')
    expect(repo.getSummary).toHaveBeenLastCalledWith('B1', expect.objectContaining({ supplierKey: 'emzor', from: null, to: null }))
    expect(text()).toMatch(/Emzor · All time/)
    await choose(supplierSelect(), '')
    const back = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Purchases')
    await act(async () => { back.click() }); await settle()
    expect(supplierSelect().value).toBe('')
  })
})
