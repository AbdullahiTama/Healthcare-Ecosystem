// Client profile › Client Account: financial summary, summary and detailed statements for a period (the closing
// balance of one period opens the next), the check against Debt Management, and Excel / PDF for permitted roles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getAll: vi.fn(), getAccountRecords: vi.fn(), getSales: vi.fn(async () => []), getAppointments: vi.fn(async () => []), getDebts: vi.fn(async () => []), getConsultations: vi.fn(async () => []) }))
const debts = vi.hoisted(() => ({ getOpen: vi.fn(), create: vi.fn() }))
const exporter = vi.hoisted(() => ({ exportClientStatementXlsx: vi.fn(async () => {}), printClientStatement: vi.fn() }))
vi.mock('./repositories', () => ({ clientRepository: repo, isDuplicateError: () => false }))
vi.mock('../debts/repositories', () => ({ debtRepository: debts }))
vi.mock('./clientStatementExport', async (orig) => ({ ...(await orig()), ...exporter }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-16' }))

import Clients from './Clients.jsx'

const RECORDS = {
  sales: [
    { id: 's1', txn_no: 'TXN-1', created_at: '2026-10-01T09:00:00', total: 10000, amount_paid: 4000, balance: 6000, items: '[]' },
    { id: 's2', txn_no: 'TXN-2', created_at: '2026-11-03T09:00:00', total: 2000, amount_paid: 2000, balance: 0, items: '[]' },
  ],
  salePayments: [
    { id: 'p1', sale_id: 's1', kind: 'sale', method: 'Cash', amount: 4000, received_at: '2026-10-01T09:00:01Z' },
    { id: 'p2', sale_id: 's2', kind: 'sale', method: 'Cash', amount: 2000, received_at: '2026-11-03T09:00:01Z' },
  ],
  debts: [{ id: 'd1', direction: 'owes_us', source: 'manual', source_ref: 'opening_balance', amount: 1000, balance: 1000, created_at: '2026-09-30' }],
  debtPayments: [],
}

let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }
const dialog = () => document.querySelector('[role="dialog"]')
const summary = () => dialog().querySelector('section[aria-label="Financial summary"]')
async function mount(role = 'Owner', perms = {}) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter><Clients brand={{ id: 'b1', name: 'Pharm Tama', business_type: 'pharmacy' }} role={role} perms={perms} /></MemoryRouter></QueryClientProvider>) })
  await flush(); await flush()
}
async function openAccount() {
  await click([...document.querySelectorAll('div')].reverse().find((d) => d.textContent === 'Ada Obi'))
  await click(btn((b) => b.getAttribute('role') === 'tab' && b.textContent === 'Client Account', dialog()))
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getAll.mockResolvedValue([{ id: 'c1', full_name: 'Ada Obi', phone: '0801', total_spend: 12000, visit_count: 2 }])
  repo.getAccountRecords.mockResolvedValue(RECORDS)
  // What Debt Management has open for Ada: the credit sale's 6,000 and the opening 1,000.
  debts.getOpen.mockResolvedValue([
    { client_id: 'c1', direction: 'owes_us', balance: 6000, status: 'pending', source: 'credit_sale' },
    { client_id: 'c1', direction: 'owes_us', balance: 1000, status: 'pending', source: 'manual' },
  ])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = '' })

describe('Client Account', () => {
  it('shows the financial summary built from the client\'s records', async () => {
    await mount()
    await openAccount()
    expect(repo.getAccountRecords).toHaveBeenCalledWith('c1', 'b1')
    const t = summary().textContent
    expect(t).toContain('Total purchases₦12,000')
    expect(t).toContain('Payments received₦6,000')
    expect(t).toContain('Returns and credit notes₦0')
    expect(t).toContain('Outstanding balance₦7,000')
    expect(t).toContain('Available credit₦0')
    expect(t).toContain('Client owes us')
    // Agrees with Debt Management: no warning.
    expect(dialog().textContent).not.toContain('differ by')
  })

  it('detailed statement: opening, entries with running balance, closing; a later period opens at the earlier close', async () => {
    await mount()
    await openAccount()
    let t = dialog().textContent
    expect(t).toContain('Opening balance brought forward₦0')
    expect(t).toContain('TXN-1')
    expect(t).toContain('Closing balance carried forward₦7,000')
    await click(btn((b) => b.textContent === 'Last month', dialog()))
    t = dialog().textContent
    expect(t).toContain('2026-10-01 to 2026-10-31')
    expect(t).toContain('Opening balance brought forward₦1,000')
    expect(t).toContain('Closing balance carried forward₦7,000')
    await click(btn((b) => b.textContent === 'This month', dialog()))
    t = dialog().textContent
    expect(t).toContain('Opening balance brought forward₦7,000')
    expect(t).toContain('TXN-2')
    expect(t).not.toContain('TXN-1')
  })

  it('summary statement lists opening, purchases, payments, returns, refunds, adjustments and closing', async () => {
    await mount()
    await openAccount()
    await click(btn((b) => b.textContent === 'Summary statement', dialog()))
    const t = dialog().textContent
    for (const label of ['Opening balance', 'Purchases', 'Payments received', 'Returns and credit notes', 'Refunds paid to client', 'Opening balances recorded', 'Adjustments', 'Closing balance']) expect(t).toContain(label)
  })

  it('exports Excel and prints a PDF of the statement shown, for the Owner', async () => {
    await mount()
    await openAccount()
    await click(btn((b) => b.textContent === 'Last month', dialog()))
    await click(btn((b) => b.textContent.trim() === 'Excel', dialog()))
    const [st, opts] = exporter.exportClientStatementXlsx.mock.calls[0]
    expect(st).toMatchObject({ from: '2026-10-01', to: '2026-10-31', opening: 1000, closing: 7000 })
    expect(opts).toMatchObject({ view: 'detailed', client: expect.objectContaining({ full_name: 'Ada Obi' }), business: expect.objectContaining({ name: 'Pharm Tama' }) })
    await click(btn((b) => b.textContent.includes('PDF'), dialog()))
    expect(exporter.printClientStatement).toHaveBeenCalledTimes(1)
  })

  it('no export without permission; with canExportReports, yes', async () => {
    await mount('Cashier')
    await openAccount()
    expect(btn((b) => b.textContent.trim() === 'Excel', dialog())).toBeUndefined()
    await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = ''
    await mount('Cashier', { canExportReports: true })
    await openAccount()
    expect(btn((b) => b.textContent.trim() === 'Excel', dialog())).toBeTruthy()
  })

  it('says when the account and Debt Management disagree (an unlinked record)', async () => {
    debts.getOpen.mockResolvedValue([
      { client_id: 'c1', direction: 'owes_us', balance: 6000, status: 'pending', source: 'credit_sale' },
      { client_id: 'c1', direction: 'owes_us', balance: 1000, status: 'pending', source: 'manual' },
      { client_id: null, party_name: 'Ada Obi', direction: 'owes_us', balance: 500, status: 'pending', source: 'credit_sale' },
    ])
    await mount()
    await openAccount()
    expect(dialog().textContent).toContain('This account and Debt Management differ by ₦500')
  })

  it('empty, failed and invalid-period states', async () => {
    repo.getAccountRecords.mockResolvedValueOnce({ sales: [], salePayments: [], debts: [], debtPayments: [] })
    debts.getOpen.mockResolvedValue([])
    await mount()
    await openAccount()
    expect(dialog().textContent).toContain('No transactions yet.')
    await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = ''
    repo.getAccountRecords.mockRejectedValueOnce(new Error('offline'))
    await mount()
    await openAccount()
    expect(dialog().textContent).toContain("We couldn't load this client's account")
    await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = ''
    await mount()
    await openAccount()
    const [from, to] = [...dialog().querySelectorAll('input[type="date"]')]
    const setDate = async (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
    await setDate(from, '2026-11-10')
    await setDate(to, '2026-11-01')
    expect(dialog().textContent).toContain('The start date is after the end date.')
    expect(btn((b) => b.textContent.trim() === 'Excel', dialog())).toBeUndefined()
  })
})
