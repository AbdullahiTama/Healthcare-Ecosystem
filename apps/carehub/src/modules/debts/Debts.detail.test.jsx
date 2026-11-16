// Every debt opens in full: the credit sale it came from (items bought,
// payments made, what is outstanding), the purchase invoice, or the debt.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const debts = vi.hoisted(() => ({ getAll: vi.fn(), update: vi.fn(), create: vi.fn(), recordPayment: vi.fn(), getPayments: vi.fn() }))
const sales = vi.hoisted(() => ({ getById: vi.fn() }))
const payments = vi.hoisted(() => ({ recordCollection: vi.fn(), getForSale: vi.fn() }))
const purchases = vi.hoisted(() => ({ getById: vi.fn(), getPayments: vi.fn() }))
vi.mock('./repositories', () => ({ debtRepository: debts }))
vi.mock('../pos/repositories', async (orig) => {
  const real = await orig()
  return { ...real, saleRepository: sales, paymentRepository: payments }
})
vi.mock('../purchases/repositories', () => ({ purchaseRepository: purchases }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(async () => []), sbFetchWithCount: vi.fn() }))

import Debts from './Debts.jsx'

const SALE_DEBT = { id: 'd1', party_name: 'Bola Ade', client_id: 'c1', direction: 'owes_us', amount: 5000, amount_paid: 2000, balance: 3000, status: 'pending', source: 'credit_sale', source_ref: 'TXN-1', created_at: '2026-10-21' }
const PURCHASE_DEBT = { id: 'd2', party_name: 'Emzor Ltd', direction: 'we_owe', amount: 9000, amount_paid: 0, balance: 9000, status: 'pending', source: 'purchase', source_ref: 'p-1', created_at: '2026-10-20' }
const MANUAL_DEBT = { id: 'd3', party_name: 'Chidi', direction: 'owes_us', amount: 500, amount_paid: 0, balance: 500, status: 'pending', source: 'manual', description: 'Borrowed for transport', created_at: '2026-10-19' }

let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const dialog = () => document.querySelector('[role="dialog"]')
const showTab = async (label) => { await act(async () => { [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith(label)).click() }); await flush() }
const setAmount = async (value) => {
  const el = dialog().querySelector('input[type="number"]')
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const submitPayment = async () => { await act(async () => { dialog().querySelector('form[aria-label="Record a payment"]').requestSubmit() }); await flush(); await flush() }
async function openDebt(name) {
  await act(async () => { host.querySelector(`button[aria-label="View debt: ${name}"]`).click() })
  await flush(); await flush()
}

beforeEach(async () => {
  vi.clearAllMocks()
  debts.getAll.mockResolvedValue([SALE_DEBT, PURCHASE_DEBT, MANUAL_DEBT])
  sales.getById.mockResolvedValue({ id: 'sale-1', txn_no: 'TXN-1', client_name: 'Bola Ade', total: 5000, amount_paid: 2000, balance: 3000, is_credit: true,
    payment_method: 'Credit', created_at: '2026-10-21T10:00:00', items: JSON.stringify([{ name: 'Amoxil 500mg', qty: 2, price: 2500 }]) })
  payments.getForSale.mockResolvedValue([{ id: 'x', kind: 'sale', method: 'Cash', amount: 2000, received_at: '2026-10-21T10:00:00Z', staff_name: 'Ada' }])
  purchases.getById.mockResolvedValue({ id: 'p-1', supplier_name: 'Emzor Ltd', total_cost: 9000, amount_paid: 0, balance: 9000, status: 'pending', items: [{ name: 'Panadol', qty: 30, cost: 300 }] })
  purchases.getPayments.mockResolvedValue([])
  debts.getPayments.mockResolvedValue([{ id: 'dp1', amount: 100, method: 'Cash', kind: 'payment', paid_on: '2026-10-25', balance_after: 400, staff_name: 'Ada' }])
  debts.recordPayment.mockResolvedValue({ amount: 200, amount_paid: 200, balance: 300, status: 'pending' })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Debts brand={{ id: 'b' }} role='Owner' perms={{}} /></QueryClientProvider>) })
  await flush()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear() })

describe('Debts: open a debt', () => {
  it('a customer\'s credit-sale debt shows the original sale: items, payments and what is outstanding', async () => {
    await openDebt('Bola Ade')
    expect(sales.getById).toHaveBeenCalledWith('b', 'TXN-1')
    expect(dialog().textContent).toContain('Receipt TXN-1')
    expect(dialog().textContent).toContain('Amoxil 500mg')
    expect(dialog().textContent).toContain('×2 @ ₦2,500')
    expect(dialog().textContent).toContain('Paid at the till · Cash')
    expect(dialog().textContent).toContain('Outstanding')
    expect(dialog().textContent).toContain('₦3,000')
  })

  it('a supplier debt (Payables tab) shows the purchase invoice', async () => {
    await showTab('Payables')
    await openDebt('Emzor Ltd')
    expect(purchases.getById).toHaveBeenCalledWith('p-1', 'b')
    expect(dialog().textContent).toContain('Purchase from Emzor Ltd')
    expect(dialog().textContent).toContain('Panadol')
    expect(dialog().textContent).toContain('₦9,000')
  })

  it('a debt recorded by hand opens with its payment history and takes a part payment', async () => {
    await openDebt('Chidi')
    expect(dialog().textContent).toContain('Borrowed for transport')
    expect(dialog().textContent).toContain('Balance')
    expect(dialog().textContent).toContain('Payment history')
    expect(debts.getPayments).toHaveBeenCalledWith('b', 'd3')
    expect(dialog().textContent).toContain('by Ada')
    await setAmount('200')
    await submitPayment()
    expect(debts.recordPayment).toHaveBeenCalledWith('d3', { amount: 200, method: 'Cash', paidOn: expect.any(String), note: null, staffName: null })
    expect(debts.update).not.toHaveBeenCalled()
    expect(host.textContent).toContain('₦300 still owed')
  })

  it('more than the balance is refused before anything is sent', async () => {
    await openDebt('Chidi')
    await setAmount('900')
    await submitPayment()
    expect(debts.recordPayment).not.toHaveBeenCalled()
    expect(dialog().textContent).toMatch(/more than/i)
  })

  it('when the original sale is gone, the debt is still shown, with a note', async () => {
    sales.getById.mockResolvedValue(null)
    await openDebt('Bola Ade')
    expect(dialog().textContent).toContain('could not be found')
    expect(dialog().textContent).toContain('₦3,000')
  })

  it('Record payment in the row opens the payment dialog for a debt recorded by hand; sale debts keep Mark paid', async () => {
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Mark paid')).toHaveLength(1)
    await act(async () => { host.querySelector('button[aria-label="Record payment: Chidi"]').click() })
    await flush()
    expect(dialog().textContent).toContain('Payment from Chidi')
    expect(debts.update).not.toHaveBeenCalled()
  })
})
