// Page-level behaviour of the Sales & Accounts report: which state shows, that
// figures follow the filters, and that a cashier sees only their own work.
// The arithmetic itself is pinned in salesReport.test.js.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = { userId: 'u1', query: null }
vi.mock('./useSalesReportData', () => ({
  useAuthUserId: () => state.userId,
  useSalesReportData: () => state.query,
  useInvalidateSalesReport: () => vi.fn(),
}))
vi.mock('../../hooks/queries', () => ({ useSettings: () => ({ data: {} }) }))
vi.mock('./ShiftControl', () => ({ default: () => null }))
vi.mock('../audit/repositories', () => ({ auditRepository: { recordExport: vi.fn() } }))

import SalesReport from './SalesReport.jsx'

const sale = (o) => ({ business_id: 'b', is_on_hold: false, status: null, discount: 0, refunded_amount: 0, client_name: 'Walk-in',
  items: [{ id: 'p1', name: 'Amoxil', qty: 1, price: 100 }], payment_method: 'Cash', created_at: new Date().toISOString().slice(0, 19), ...o })
const SALES = [
  sale({ id: 's1', txn_no: 'TXN-1', client_name: 'Bola', total: 100000, amount_paid: 70000, payment_method: 'Credit', cashier_user_id: 'u1', staff_name: 'Rep One' }),
  sale({ id: 's2', txn_no: 'TXN-2', total: 3000, amount_paid: 3000, cashier_user_id: 'u2', staff_name: 'Rep Two' }),
]
const PAYMENTS = [
  { id: 1, sale_id: 's1', kind: 'sale', method: 'Transfer', amount: 70000, received_by: 'u1', staff_name: 'Rep One', received_at: new Date().toISOString() },
  { id: 2, sale_id: 's2', kind: 'sale', method: 'Cash', amount: 3000, received_by: 'u2', staff_name: 'Rep Two', received_at: new Date().toISOString() },
]
const loaded = (over = {}) => ({
  isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  data: { sales: SALES, payments: PAYMENTS, salesById: { s1: SALES[0], s2: SALES[1] }, shifts: [], ledgerAvailable: true, shiftsAvailable: true, ...over },
})

let mounted
async function render(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><SalesReport brand={{ id: 'b', name: 'Ada Pharmacy' }} role='Owner' perms={{ canViewReports: true, canExportReports: true }} staffName='Ada' {...props} /></MemoryRouter>)
  })
  mounted = { host, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
  return host
}
afterEach(async () => { if (mounted) await mounted.unmount(); mounted = null; state.userId = 'u1' })

const keyFigure = (host, label) => {
  const box = [...host.querySelectorAll('[aria-label="Key figures"] > div')].find((d) => d.firstChild.textContent === label)
  return box?.lastChild.textContent
}

describe('SalesReport page', () => {
  it('shows a loading state while the period loads', async () => {
    state.query = { isLoading: true, data: undefined }
    const host = await render()
    expect(host.textContent).toContain('Loading sales')
  })

  it('shows an error with retry', async () => {
    state.query = { isLoading: false, isError: true, error: new Error('Supabase error (500): down'), refetch: vi.fn() }
    const host = await render()
    expect(host.querySelector('[role="alert"]').textContent).toContain('Could not load the report: down')
  })

  it('an empty period says so', async () => {
    state.query = loaded({ sales: [], payments: [], salesById: {} })
    const host = await render()
    expect(host.textContent).toContain('No sales today.')
  })

  it('an owner sees every cashier: the request example reconciles across the whole shop', async () => {
    state.query = loaded()
    const host = await render()
    expect(keyFigure(host, 'Total sales')).toBe('₦103,000')
    expect(keyFigure(host, 'Net received')).toBe('₦73,000')
    expect(keyFigure(host, 'Outstanding')).toBe('₦30,000')
    expect(keyFigure(host, 'Transactions')).toBe('2')
    expect(host.textContent).toContain('TXN-1')
    expect(host.textContent).toContain('TXN-2')
  })

  it('figures follow the filters', async () => {
    state.query = loaded()
    const host = await render()
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Filters')).click() })
    const cashier = host.querySelector('select#cashier')
    await act(async () => {
      cashier.value = 'u2'
      cashier.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(keyFigure(host, 'Total sales')).toBe('₦3,000')
    expect(keyFigure(host, 'Outstanding')).toBe('₦0')
    expect(host.textContent).not.toContain('TXN-1')
  })

  it('a cashier sees only their own transactions and gets no cashier filter', async () => {
    state.query = loaded()
    state.userId = 'u2'
    const host = await render({ role: 'Cashier', perms: { canViewReports: false, canExportReports: false } })
    expect(keyFigure(host, 'Total sales')).toBe('₦3,000')
    expect(host.textContent).toContain('your transactions')
    expect(host.textContent).not.toContain('TXN-1')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Filters')).click() })
    expect(host.querySelector('select#cashier')).toBeNull()
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.includes('Excel'))).toBe(false)
  })

  it('before the ledger exists, money is flagged as estimated and the payments tab is hidden', async () => {
    state.query = loaded({ payments: [], ledgerAvailable: false, shiftsAvailable: false })
    const host = await render()
    expect(host.textContent).toContain('Money figures are estimated')
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Sales2'])
  })

  it('no profit or cost figure appears anywhere on the page', async () => {
    state.query = loaded()
    const host = await render()
    expect(host.textContent).not.toMatch(/\b(profit|margin|cost)\b/i)
  })
})
