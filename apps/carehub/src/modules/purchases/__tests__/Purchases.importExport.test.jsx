// Purchases screen: upload purchases from a CSV (preview first, then each purchase recorded like the form: purchase
// record, stock through receive_stock, a debt for the balance), and export them (Owner or a role allowed to export,
// audited before the file is saved).
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const repo = vi.hoisted(() => ({
  getPage: vi.fn(), getTotals: vi.fn(async () => [{ purchase_count: 1, total_paid: 0, total_owed: 0 }]),
  getSupplierStats: vi.fn(async () => []), getSupplierBalances: vi.fn(async () => []), getProductStats: vi.fn(async () => []),
  getAllPages: vi.fn(async () => []), getAllForExport: vi.fn(), create: vi.fn(),
}))
const products = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), receiveStock: vi.fn() }))
const debts = vi.hoisted(() => ({ recordUnderpayment: vi.fn() }))
const audit = vi.hoisted(() => ({ recordExport: vi.fn() }))
const exportService = vi.hoisted(() => ({ downloadBlob: vi.fn() }))
vi.mock('../repositories', () => ({ purchaseRepository: repo }))
vi.mock('../../inventory/repositories', () => ({ productRepository: products }))
vi.mock('../../debts/repositories', () => ({ debtRepository: debts }))
vi.mock('../../audit/repositories', () => ({ auditRepository: audit }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../business-directory/services/exportService', async (orig) => ({ ...(await orig()), downloadBlob: exportService.downloadBlob }))
vi.mock('../../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-10' }))

import Purchases from '../Purchases'

let host, root, qc, setProducts
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush() }
// Polls until `check` passes (the Excel build is loaded on demand and takes a few ticks).
const until = async (check, tries = 100) => { for (let i = 0; ; i++) { try { check(); return } catch (e) { if (i >= tries) throw e; await act(async () => { await new Promise((r) => setTimeout(r, 20)) }) } } }
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const dialog = () => document.querySelector('[role="dialog"]')
const text = () => document.body.textContent
const inventory = [{ id: 'P-PARA', name: 'Paracetamol 500mg', price: 80, cost_price: 40, stock: 5, category: 'Medicines' }]

async function mount({ role = 'Owner', perms = {} } = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Purchases brand={{ id: 'B1' }} role={role} perms={perms} products={inventory} setProducts={setProducts} catalog={{ status: 'ready', reload: vi.fn() }} staffName='Ada' /></QueryClientProvider>) })
  await flush()
}
async function upload(csv, name = 'purchases.csv') {
  const input = dialog().querySelector('input[type="file"]')
  const file = new File([csv], name, { type: 'text/csv' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}

const CSV = [
  'Purchase Ref,Supplier,Supply Date,Product Name,Quantity,Unit Cost (NGN),Amount Paid (NGN),Due Date',
  'INV-1,Emzor,03/11/2026,Paracetamol 500mg,100,45,1000,30/11/2026',
  'INV-1,Emzor,03/11/2026,Vitamin C,10,100,,',
  'INV-2,Fidson,2026-11-04,Zinc,abc,50,,',
].join('\n')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setProducts = vi.fn()
  repo.getPage.mockResolvedValue([{ id: 'p1', supplier_name: 'MedSupply', product_name: 'ORS', quantity: 1, total_cost: 100, amount_paid: 100, balance: 0, supply_date: '2026-10-30', status: 'paid' }])
  repo.create.mockResolvedValue([{ id: 'NEW-PURCHASE' }])
  products.update.mockImplementation(async (id, _b, u) => ({ id, ...u }))
  products.create.mockImplementation(async (_b, p) => [{ id: 'NEW-' + p.name, ...p }])
  products.receiveStock.mockResolvedValue({ stock: 105 })
  debts.recordUnderpayment.mockResolvedValue({})
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('upload', () => {
  it('previews every purchase, records only the valid ones like the form, and refreshes', async () => {
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Upload'))
    await upload(CSV)

    // Preview: nothing saved yet; the bad row is named.
    expect(repo.create).not.toHaveBeenCalled()
    expect(text()).toContain('Row 4: Quantity "abc" is not a number.')
    expect(text()).toMatch(/1 purchase cannot be recorded until the rows below are fixed/)
    expect(repo.getAllPages).toHaveBeenCalledWith('B1', { from: '2026-11-03', to: '2026-11-04' })

    await click(btn((b) => b.textContent === 'Record 1 purchase'))
    await settle()

    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.create.mock.calls[0][1]).toMatchObject({ supplier_name: 'Emzor', supply_date: '2026-11-03', due_date: '2026-11-30', total_cost: 5500, amount_paid: 1000, balance: 4500, status: 'pending', notes: 'Ref INV-1' })
    // The existing product is restocked, the new one created, each line received once with its own key.
    expect(products.update).toHaveBeenCalledWith('P-PARA', 'B1', { cost_price: 45 })
    expect(products.create.mock.calls[0][1]).toMatchObject({ name: 'Vitamin C', cost_price: 100, stock: 0 })
    expect(products.receiveStock.mock.calls.map((c) => [c[1], c[2], c[3].sourceId])).toEqual([['P-PARA', 100, 'NEW-PURCHASE'], ['NEW-Vitamin C', 10, 'NEW-PURCHASE']])
    expect(new Set(products.receiveStock.mock.calls.map((c) => c[3].idempotencyKey)).size).toBe(2)
    expect(debts.recordUnderpayment).toHaveBeenCalledWith(expect.objectContaining({ partyName: 'Emzor', amount: 5500, amountPaid: 1000, sourceRef: 'NEW-PURCHASE' }))
    expect(text()).toContain('1 purchase recorded')
    expect(setProducts).toHaveBeenCalled()
  })

  it('a file uploaded twice: the purchase already recorded is skipped unless ticked', async () => {
    repo.getAllPages.mockResolvedValue([{ supplier_name: 'Fidson', supply_date: '2026-11-04', total_cost: 100 }])
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Upload'))
    await upload('Supplier,Supply Date,Product Name,Quantity,Unit Cost (NGN)\nFidson,2026-11-04,Zinc,2,50\n')
    expect(text()).toMatch(/1 purchase looks already recorded/)
    expect(btn((b) => b.textContent === 'Nothing to record').disabled).toBe(true)
    await act(async () => { dialog().querySelector('input[type="checkbox"]').click() })
    await flush()
    await click(btn((b) => b.textContent === 'Record 1 purchase'))
    await settle()
    expect(repo.create).toHaveBeenCalledTimes(1)
  })

  it('a file without the required columns says which, and records nothing', async () => {
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Upload'))
    await upload('Supplier,Product\nEmzor,ORS\n')
    expect(text()).toMatch(/missing the columns Supply Date, Quantity, Unit Cost \(NGN\)/)
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('an unsupported file is refused with a reason', async () => {
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Upload'))
    await upload('x', 'old.xls')
    expect(text()).toMatch(/Old .xls files are not supported/)
  })

  it('a purchase the database refuses is reported; the stock and debt of a recorded one are not retried', async () => {
    repo.create.mockRejectedValueOnce(new Error('Supabase error (403): not allowed'))
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Upload'))
    await upload('Supplier,Supply Date,Product Name,Quantity,Unit Cost (NGN)\nA,2026-11-04,Zinc,2,50\nB,2026-11-04,Zinc,2,50\n')
    await click(btn((b) => b.textContent === 'Record 2 purchases'))
    await settle()
    expect(text()).toContain('1 purchase recorded, 1 not recorded')
    expect(text()).toContain('not allowed')
    // Zinc was created once (by the purchase that was recorded), not again.
    expect(products.create).toHaveBeenCalledTimes(1)
  })
})

describe('export', () => {
  const purchase = { id: '1a2b3c4d-0000', supplier_name: 'Emzor', supply_date: '2026-11-03', total_cost: 450, amount_paid: 450, balance: 0, status: 'paid', items: [{ name: 'Paracetamol 500mg', qty: 10, cost: 45 }] }

  it('is offered to the Owner and to roles allowed to export, not to others', async () => {
    await mount({ role: 'Cashier', perms: {} })
    expect(btn((b) => b.textContent.trim() === 'Export')).toBeUndefined()
    await act(async () => root.unmount()); host.remove()
    await mount({ role: 'Stock Lead', perms: { canExportReports: true } })
    expect(btn((b) => b.textContent.trim() === 'Export')).toBeDefined()
  })

  it('exports the list with its filters as CSV, after the audit record', async () => {
    repo.getAllForExport.mockResolvedValue([purchase])
    audit.recordExport.mockResolvedValue({ status: 'recorded' })
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Export'))
    await act(async () => { dialog().querySelector('input[value="csv"]').click() })
    await click(btn((b) => b.textContent.includes('Export') && b.closest('[role="dialog"]') && b.textContent.trim() === 'Export'))
    await settle()
    expect(repo.getAllForExport).toHaveBeenCalledWith('B1', expect.objectContaining({ search: '' }))
    expect(audit.recordExport).toHaveBeenCalledWith('B1', expect.objectContaining({ exportType: 'purchases.csv', rowCount: 1 }))
    expect(exportService.downloadBlob).toHaveBeenCalledTimes(1)
    expect(exportService.downloadBlob.mock.calls[0][1]).toMatch(/\.csv$/)
    expect(text()).toContain('Exported 1 purchase.')
  })

  it('a refusal from the database saves no file', async () => {
    repo.getAllForExport.mockResolvedValue([purchase])
    audit.recordExport.mockResolvedValue({ status: 'refused' })
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Export'))
    await click([...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export'))
    await until(() => expect(text()).toContain('Your role is not allowed to export data.'))
    expect(audit.recordExport).toHaveBeenCalledWith('B1', expect.objectContaining({ exportType: 'purchases.xlsx' }))
    expect(exportService.downloadBlob).not.toHaveBeenCalled()
  })

  it('a failed load says so and saves nothing', async () => {
    repo.getAllForExport.mockRejectedValue(new Error('offline'))
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Export'))
    await click([...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export'))
    await until(() => expect(text()).toContain('Could not load the purchases to export.'))
    expect(audit.recordExport).not.toHaveBeenCalled()
  })
})
