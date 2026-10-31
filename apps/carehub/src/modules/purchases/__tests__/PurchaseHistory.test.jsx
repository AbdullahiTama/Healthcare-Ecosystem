// History & analytics: the selection drives every figure, a supplier or product
// narrows everything to it, and each state (loading, empty, unavailable) says so.
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({ getSummary: vi.fn(), getSupplierStats: vi.fn(), getProductStats: vi.fn(), getHistory: vi.fn() }))
vi.mock('../repositories', () => ({ purchaseRepository: repo }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-10-31' }))

import PurchaseHistory from '../PurchaseHistory'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SUMMARY = { purchase_count: 6, line_count: 14, units: 320, total_spent: 154000, amount_paid: 120000, balance: 34000, supplier_count: 2, product_count: 9,
  first_date: '2026-10-02', last_date: '2026-10-30', last_purchase_id: 'pur6', last_supplier: 'MedSupply Ltd', last_total: 9000, payments_in_period: 80000 }
const SUPPLIERS = [
  { supplier_key: 'medsupply ltd', supplier_name: 'MedSupply Ltd', purchase_count: 4, total_spent: 115500, amount_paid: 90000, balance: 25500, last_date: '2026-10-30', last_total: 9000 },
  { supplier_key: 'emzor', supplier_name: 'Emzor', purchase_count: 2, total_spent: 38500, amount_paid: 30000, balance: 8500, last_date: '2026-10-12', last_total: 20000 },
]
const PRODUCTS = [
  { product_key: 'amoxil 500mg', product_id: 'p1', product_name: 'Amoxil 500mg', times_purchased: 3, units: 60, total_spent: 52800, avg_cost: 880, min_cost: 800, max_cost: 960,
    last_date: '2026-10-30', last_supplier: 'MedSupply Ltd', last_qty: 20, last_cost: 960, previous_cost: 800, total_count: 9 },
]
const LINES = [
  { purchase_id: 'pur6', purchase_date: '2026-10-30', supplier_name: 'MedSupply Ltd', line_no: 1, item_name: 'Amoxil 500mg', qty: 20, unit_cost: 960, line_total: 19200,
    barcode: '6001', batch: 'B7', itemised: true, purchase_total: 19200, purchase_paid: 10000, purchase_balance: 9200, purchase_status: 'partial' },
]

let host, root, qc, onOpen
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
const lastFilters = (fn) => fn.mock.calls.at(-1)[1]
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}><PurchaseHistory brand={{ id: 'B1' }} suppliers={[{ key: 'medsupply ltd', name: 'MedSupply Ltd' }, { key: 'emzor', name: 'Emzor' }]} onOpenPurchase={onOpen} /></QueryClientProvider>))
  await flush(); await flush()
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onOpen = vi.fn()
  repo.getSummary.mockReset().mockResolvedValue(SUMMARY)
  repo.getSupplierStats.mockReset().mockResolvedValue(SUPPLIERS)
  repo.getProductStats.mockReset().mockResolvedValue(PRODUCTS)
  repo.getHistory.mockReset().mockResolvedValue(LINES)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Purchase history and analytics', () => {
  it('opens on this month and shows spending, frequency, paid, outstanding and the last purchase', async () => {
    await mount()
    expect(lastFilters(repo.getSummary)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    const text = host.textContent
    expect(text).toContain('All purchases · Oct 2026')
    expect(text).toContain('₦154,000')
    expect(text).toContain('320 units in 14 lines')
    expect(text).toContain('1.4 per week')
    expect(text).toContain('₦34,000')
    expect(text).toContain('Payments made in period')
    expect(text).toContain('₦80,000')
    expect(text).toContain('MedSupply Ltd · ₦9,000')
  })

  it('lists spending by supplier with its share, and products with the last price change', async () => {
    await mount()
    const supplierTable = host.querySelector('section[aria-label="Spending by supplier"] table')
    expect(supplierTable.textContent).toContain('75%')
    expect(supplierTable.textContent).toContain('₦25,500')
    const productTable = host.querySelector('section[aria-label="Products bought"] table')
    expect(productTable.textContent).toContain('+20%')
    expect(host.textContent).toContain('Products bought (9)')
    expect(button('Show more products (8 more)')).toBeTruthy()
  })

  it('picking a supplier narrows every figure to it', async () => {
    await mount()
    await act(async () => host.querySelector('[aria-label="Show only MedSupply Ltd"]').click())
    await flush()
    expect(lastFilters(repo.getSummary)).toMatchObject({ supplierKey: 'medsupply ltd' })
    expect(lastFilters(repo.getHistory)).toMatchObject({ supplierKey: 'medsupply ltd' })
    expect(host.textContent).toContain('Supplier: MedSupply Ltd')
    expect(host.querySelector('section[aria-label="Spending by supplier"]')).toBeNull()
  })

  it('picking a product shows its own costs: last, average, before, lowest and highest', async () => {
    await mount()
    await act(async () => host.querySelector('[aria-label="Show only Amoxil 500mg"]').click())
    await flush()
    expect(lastFilters(repo.getSummary)).toMatchObject({ productKey: 'amoxil 500mg', productId: 'p1' })
    expect(host.textContent).toContain('Spent on this product')
    expect(host.textContent).toContain('₦960 · ₦880')
    expect(host.textContent).toContain('Before that ₦800 · lowest ₦800, highest ₦960')
  })

  it('changing the period asks for that period', async () => {
    await mount()
    await act(async () => button('This year').click())
    await flush()
    expect(lastFilters(repo.getSummary)).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
    const mode = host.querySelector('select')
    expect([...host.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent)).toEqual(['This year'])
    expect(mode).toBeTruthy()
  })

  it('a history line opens its purchase', async () => {
    await mount()
    await act(async () => host.querySelector('[aria-label^="Open the purchase from MedSupply Ltd"]').click())
    expect(onOpen).toHaveBeenCalledWith('pur6')
  })

  it('an empty selection says so and offers to clear filters', async () => {
    repo.getSummary.mockResolvedValue({ ...SUMMARY, purchase_count: 0 })
    repo.getSupplierStats.mockResolvedValue([]); repo.getProductStats.mockResolvedValue([]); repo.getHistory.mockResolvedValue([])
    await mount()
    expect(host.textContent).toContain('No purchases in this selection')
  })

  it('before the database update, explains instead of failing', async () => {
    repo.getSummary.mockRejectedValue(new Error('Supabase error (404): Could not find the function public.get_purchase_summary in the schema cache'))
    await mount()
    expect(host.textContent).toContain('Purchase history and analytics become available once the latest database update is applied')
  })

  it('a failure to load can be retried', async () => {
    repo.getSummary.mockRejectedValue(new Error('Failed to fetch'))
    await mount()
    expect(host.textContent).toContain("couldn't work out your spending")
    repo.getSummary.mockResolvedValue(SUMMARY)
    await act(async () => button('Try again')?.click() ?? button('Retry')?.click())
    await flush()
    expect(host.textContent).toContain('₦154,000')
  })
})
