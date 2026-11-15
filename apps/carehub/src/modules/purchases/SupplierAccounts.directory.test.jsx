// Purchases › Supplier summary with the supplier list (carehub_20270119): contact details on each account, suppliers
// listed before any purchase, search by phone, adding and editing details, the import choice and the supplier-list
// import, the export's contact columns, and a failed contact-details load that leaves balances usable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getSupplierAccounts: vi.fn(), getSupplierActivity: vi.fn(), recordSupplierPayment: vi.fn(), getSuppliers: vi.fn(), createSuppliers: vi.fn(), updateSupplier: vi.fn() }))
const exporter = vi.hoisted(() => ({ auditedExport: vi.fn(async () => true) }))
const files = vi.hoisted(() => ({ readSpreadsheet: vi.fn() }))
vi.mock('./repositories', () => ({ purchaseRepository: repo }))
vi.mock('../debts/repositories', () => ({ debtRepository: { create: vi.fn(), getPayments: vi.fn(), recordPayment: vi.fn(), importRows: vi.fn() } }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../lib/auditedExport', async (orig) => ({ ...(await orig()), auditedExport: exporter.auditedExport }))
vi.mock('../business-directory/services/importService', async (orig) => ({ ...(await orig()), readSpreadsheet: files.readSpreadsheet }))

import SupplierAccounts from './SupplierAccounts.jsx'

const ACCOUNTS = [
  { supplier_key: 'emzor ltd', supplier_name: 'Emzor Ltd', purchase_count: 2, supply_count: 0, supplied_total: 5000, paid_total: 1000, balance: 4000, open_count: 1, mismatch_count: 0, last_supply_at: '2026-03-05' },
  { supplier_key: 'pharmaco', supplier_name: 'PharmaCo', purchase_count: 1, supply_count: 0, supplied_total: 2000, paid_total: 2000, balance: 0, open_count: 0, mismatch_count: 0, last_supply_at: '2026-03-06' },
]
const LIST = [
  { id: 's1', name: 'Emzor Ltd', supplier_key: 'emzor ltd', contact_person: 'Chidi Okeke', phone: '0803 111 2222', email: 'sales@emzor.example', address: 'Ikeja', notes: '' },
  { id: 's2', name: 'Fidson', supplier_key: 'fidson', contact_person: '', phone: '0809 555 0101', email: '', address: '', notes: '' },
]
let host, root, qc, toast
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const dialog = () => document.querySelector('[role="dialog"]')
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }
function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}><SupplierAccounts brand={{ id: 'biz' }} role='Owner' perms={{}} staffName='Ada' showToast={toast} onPaid={vi.fn()} /></QueryClientProvider>))
  await flush(); await flush()
}
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  toast = vi.fn()
  for (const f of [...Object.values(repo), exporter.auditedExport, files.readSpreadsheet]) f.mockReset()
  repo.getSupplierAccounts.mockResolvedValue({ available: true, rows: ACCOUNTS })
  repo.getSupplierActivity.mockResolvedValue({ supplies: [], payments: [] })
  repo.getSuppliers.mockResolvedValue({ available: true, rows: LIST })
  exporter.auditedExport.mockResolvedValue(true)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; qc.clear() })

describe('Supplier summary with the supplier list', () => {
  it('shows contact details on accounts and lists a supplier with nothing supplied yet', async () => {
    await mount()
    expect(text()).toContain('Chidi Okeke · 0803 111 2222')
    expect(text()).toContain('Fidson')
    expect(text()).toContain('Nothing supplied yet')
    expect(text()).toContain('3 suppliers')
  })

  it('finds a supplier by phone number', async () => {
    await mount()
    await act(async () => type(document.querySelector('input[type="search"]'), '0809 555'))
    await flush()
    expect(text()).toContain('1 supplier ·')
    expect(text()).toContain('Fidson')
    expect(text()).not.toContain('Emzor Ltd')
  })

  it('edits a supplier\'s details from its account and comes back to the account', async () => {
    repo.updateSupplier.mockResolvedValue({ ...LIST[0], phone: '0700 000 0000' })
    await mount()
    await click(btn((b) => b.getAttribute('aria-label') === "Open Emzor Ltd's account"))
    expect(dialog().textContent).toContain('sales@emzor.example')
    await click(btn((b) => b.textContent.includes('Edit details'), dialog()))
    await act(async () => type(dialog().querySelector('#supplier-phone'), '0700 000 0000'))
    await click(btn((b) => b.textContent === 'Save', dialog()))
    expect(repo.updateSupplier).toHaveBeenCalledWith('biz', 's1', { phone: '0700 000 0000' })
    expect(toast).toHaveBeenCalledWith("Emzor Ltd's details saved.", { type: 'success' })
    expect(dialog().textContent).toContain('Supplied / owed')
  })

  it('refuses a rename that would detach the supplier from its purchases', async () => {
    await mount()
    await click(btn((b) => b.getAttribute('aria-label') === "Open Emzor Ltd's account"))
    await click(btn((b) => b.textContent.includes('Edit details'), dialog()))
    await act(async () => type(dialog().querySelector('#supplier-name'), 'Emzor Pharma'))
    await click(btn((b) => b.textContent === 'Save', dialog()))
    expect(repo.updateSupplier).not.toHaveBeenCalled()
    expect(dialog().textContent).toMatch(/only be corrected in capitals or spacing/)
  })

  it('adds details for a supplier known only from purchases, under its existing name', async () => {
    repo.createSuppliers.mockResolvedValue({ added: ['PharmaCo'], skipped: 0, failed: [] })
    await mount()
    await click(btn((b) => b.getAttribute('aria-label') === "Open PharmaCo's account"))
    await click(btn((b) => b.textContent.includes('Add details'), dialog()))
    expect(dialog().querySelector('#supplier-name')).toBeNull()
    await act(async () => type(dialog().querySelector('#supplier-email'), 'orders@pharmaco.example'))
    await click(btn((b) => b.textContent === 'Save', dialog()))
    expect(repo.createSuppliers).toHaveBeenCalledWith('biz', [expect.objectContaining({ name: 'PharmaCo', email: 'orders@pharmaco.example' })])
  })

  it('adds a new supplier, and says so when the name is already listed', async () => {
    repo.createSuppliers.mockResolvedValueOnce({ added: [], skipped: 1, failed: [] })
    await mount()
    await click(btn((b) => b.textContent.includes('Add supplier')))
    await act(async () => type(dialog().querySelector('#supplier-name'), 'fidson'))
    await click(btn((b) => b.textContent === 'Save', dialog()))
    expect(dialog().textContent).toContain('fidson is already in your supplier list')
  })

  it('Import offers the supplier list or balances; the list import previews, then saves only new suppliers', async () => {
    files.readSpreadsheet.mockResolvedValue([
      ['Supplier Name', 'Phone Number', 'Email'],
      ['May & Baker', '0802 000 1111', ''],
      ['EMZOR LTD', '', ''],
      ['May and Baker', '0802 000 1111', 'oops'],
      ['', '0802 000 2222', ''],
    ])
    repo.createSuppliers.mockResolvedValue({ added: ['May & Baker'], skipped: 0, failed: [] })
    await mount()
    await click(btn((b) => b.textContent.includes('Import')))
    expect(dialog().textContent).toContain('Supplier list')
    expect(dialog().textContent).toContain('Opening balances and payments')
    await click(btn((b) => b.textContent.includes('Supplier list'), dialog()))
    const input = dialog().querySelector('input[type="file"]')
    await act(async () => { Object.defineProperty(input, 'files', { value: [new File(['x'], 'suppliers.xlsx')] }); input.dispatchEvent(new Event('change', { bubbles: true })) })
    await flush(); await flush()
    const d = dialog().textContent
    expect(d).toContain('Row 2: May & Baker')
    expect(d).toContain('Emzor Ltd is already in your list.')
    expect(d).toContain('not an email address')
    expect(d).toContain('The supplier name is missing.')
    await click(btn((b) => b.textContent === 'Import 1 supplier', dialog()))
    expect(repo.createSuppliers).toHaveBeenCalledWith('biz', [{ name: 'May & Baker', contact_person: '', phone: '0802 000 1111', email: '', address: '', notes: '' }])
    expect(dialog().textContent).toContain('1 supplier added.')
    expect(dialog().textContent).toContain('2 rows were not imported')
  })

  it('exports contact details with the balances', async () => {
    await mount()
    await click(btn((b) => b.textContent.includes('Export')))
    await click(btn((b) => /Excel/.test(b.textContent), dialog()) || btn((b) => b.textContent.includes('Export'), dialog()))
    const call = exporter.auditedExport.mock.calls[0]?.[0]
    expect(call.columns.map((c) => c.header).slice(0, 4)).toEqual(['Supplier', 'Contact Person', 'Phone Number', 'Email'])
    expect(call.rows.find((r) => r.name === 'Fidson').phone).toBe('0809 555 0101')
    expect(call.exportType).toBe('supplier_accounts')
  })

  it('keeps balances usable when contact details cannot be loaded', async () => {
    repo.getSuppliers.mockRejectedValue(new Error('network'))
    await mount()
    expect(text()).toContain('Contact details could not be loaded')
    expect(text()).toContain('Emzor Ltd')
    expect(btn((b) => b.textContent.includes('Add supplier'))).toBeUndefined()
  })
})
