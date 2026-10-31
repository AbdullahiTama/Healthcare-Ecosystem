// Page-level behaviour of the Sales & Accounts report: which state shows, that
// figures follow the filters, and that a cashier sees only their own work.
// The arithmetic itself is pinned in salesReport.test.js.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = { userId: 'u1', query: null, mobile: false }
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: state.mobile }) }))
vi.mock('./useSalesReportData', () => ({
  useAuthUserId: () => state.userId,
  useSalesReportData: () => state.query,
  useInvalidateSalesReport: () => vi.fn(),
}))
vi.mock('../../hooks/queries', () => ({ useSettings: () => ({ data: {} }) }))
vi.mock('./ShiftControl', () => ({ default: () => null }))
vi.mock('../audit/repositories', () => ({ auditRepository: { recordExport: vi.fn() } }))
const receipts = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('./repositories', () => ({ saleRepository: { searchReceipts: receipts.search, history: vi.fn(async () => []) }, paymentRepository: { getForSale: vi.fn(async () => []) } }))

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
afterEach(async () => { if (mounted) await mounted.unmount(); mounted = null; state.userId = 'u1'; state.mobile = false })

const setInput = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const comboboxFor = (host, label) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === label)
  return l ? document.getElementById(l.htmlFor) : null
}
async function pickFromCombobox(host, label, typed, optionText) {
  const box = comboboxFor(host, label)
  await act(async () => { box.focus() })
  await setInput(box, typed)
  const option = [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent === optionText)
  await act(async () => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
}
const searchBox = (host) => host.querySelector('input[aria-label="Search sales and receipts"]')

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
    // The cashier filter is searchable: type part of the name, pick it.
    await pickFromCombobox(host, 'Cashier', 'two', 'Rep Two')
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
    expect(comboboxFor(host, 'Cashier')).toBeNull()
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

  it('on a phone: two-column key figures and a card per sale instead of the wide table', async () => {
    state.query = loaded()
    state.mobile = true
    const host = await render()
    expect(host.querySelector('[aria-label="Key figures"]').style.gridTemplateColumns).toBe('repeat(2, 1fr)')
    expect(host.querySelector('table')).toBeNull()
    const cards = [...host.querySelectorAll('button[aria-label^="Receipt "]')]
    expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual(expect.arrayContaining([expect.stringContaining('TXN-1'), expect.stringContaining('TXN-2')]))
  })

  it('on desktop the wide table scrolls inside its own card, never the page', async () => {
    state.query = loaded()
    const host = await render()
    const table = host.querySelector('table')
    expect(table.style.minWidth).toBe('980px')
    expect(table.parentElement.style.overflowX).toBe('auto')
  })

  it('the key figures stay pinned while the list scrolls', async () => {
    state.query = loaded()
    const host = await render()
    expect(host.querySelector('[aria-label="Key figures"]').parentElement.style.position).toBe('sticky')
  })
})

describe('SalesReport search', () => {
  it('narrows the list by customer, product, amount or receipt, and keeps the totals for the whole period', async () => {
    state.query = loaded()
    const host = await render()
    await setInput(searchBox(host), 'bola')
    expect(host.textContent).toContain('TXN-1')
    expect(host.textContent).not.toContain('TXN-2')
    expect(host.textContent).toContain('1 of 2 sales match')
    // Totals still describe the whole period and filters.
    expect(keyFigure(host, 'Total sales')).toBe('₦103,000')
    await setInput(searchBox(host), '₦3,000')
    expect(host.textContent).toContain('TXN-2')
    expect(host.textContent).not.toContain('TXN-1')
    await setInput(searchBox(host), 'amoxil 100000')
    expect(host.textContent).toContain('TXN-1')
    expect(host.textContent).not.toContain('TXN-2')
  })

  it('searches the payments list too', async () => {
    state.query = loaded()
    const host = await render()
    await act(async () => { [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith('Payments')).click() })
    await setInput(searchBox(host), 'transfer')
    const tab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith('Payments'))
    expect(tab.textContent).toContain('1')
    expect(host.textContent).toContain('TXN-1')
    expect(host.textContent).not.toContain('TXN-2')
  })

  it('looks a receipt up in all dates when it is not in the period, and opens it', async () => {
    state.query = loaded()
    receipts.search.mockResolvedValue([sale({ id: 'old', txn_no: 'TXN-104154', client_name: 'Chidi', total: 4500, amount_paid: 4500, created_at: '2026-09-02T10:00:00', cashier_user_id: 'u1' })])
    const host = await render()
    await setInput(searchBox(host), '104154')
    expect(host.textContent).toContain('No sales match “104154”')
    const lookUp = [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Look up receipt “104154” in all dates'))
    await act(async () => { lookUp.click() })
    await act(async () => {})
    expect(receipts.search).toHaveBeenCalledWith('b', '104154')
    expect(host.textContent).toContain('Found on other dates (1)')
    expect(host.textContent).toContain('Chidi')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.includes('TXN-104154')).click() })
    expect(document.querySelector('[role="dialog"]').textContent).toContain('TXN-104154')
  })

  it("keeps a cashier's look-up to their own sales", async () => {
    state.query = loaded()
    state.userId = 'u2'
    receipts.search.mockResolvedValue([sale({ id: 'old', txn_no: 'TXN-104154', client_name: 'Chidi', total: 4500, amount_paid: 4500, cashier_user_id: 'u1' })])
    const host = await render({ role: 'Cashier', perms: { canViewReports: false } })
    await setInput(searchBox(host), '104154')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Look up receipt')).click() })
    await act(async () => {})
    expect(host.textContent).toContain('No receipt containing “104154” on any date.')
    expect(host.textContent).not.toContain('Chidi')
  })

  it('a product filter can be searched instead of scrolled, and cleared with "All products"', async () => {
    state.query = loaded({
      sales: [
        SALES[0],
        { ...SALES[1], items: [{ id: 'p2', name: 'Paracetamol 500mg', qty: 2, price: 1500 }] },
      ],
      salesById: { s1: SALES[0], s2: { ...SALES[1], items: [{ id: 'p2', name: 'Paracetamol 500mg', qty: 2, price: 1500 }] } },
    })
    const host = await render()
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Filters')).click() })
    const box = comboboxFor(host, 'Product')
    await act(async () => { box.focus() })
    await setInput(box, 'para')
    const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect(options).toEqual(['Paracetamol 500mg'])
    await act(async () => { host.querySelector('[role="option"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(keyFigure(host, 'Total sales')).toBe('₦3,000')
    expect(box.value).toBe('Paracetamol 500mg')
    // Still focused after picking: a click reopens the list.
    await act(async () => { box.click() })
    const all = [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'All products')
    await act(async () => { all.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(keyFigure(host, 'Total sales')).toBe('₦103,000')
  })
})
