// POS › Credit: one account per customer, with View details (each visit, what it owes, its payments, payable on its
// own), Record payment (on the whole account, oldest visits first) and View transactions.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getOpen: vi.fn() }))
const ledger = vi.hoisted(() => ({ recordCollection: vi.fn(), getForSale: vi.fn(), getForSales: vi.fn(), recordAccountPayment: vi.fn() }))
const clientsRepo = vi.hoisted(() => ({ getSales: vi.fn() }))
vi.mock('./repositories', () => ({ saleRepository: repo, paymentRepository: ledger }))
vi.mock('../clients/repositories', () => ({ clientRepository: clientsRepo }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))

import CreditCollections from './CreditCollections.jsx'
import { useOpenSales } from '../../hooks/queries'

const BRAND = { id: 'biz-1' }
const CLIENTS = [{ id: 'c1', full_name: 'Mama Ngozi', phone: '0803 111 2222' }]
let host, root, qc, toast

function Screen({ role = 'Owner' }) {
  const q = useOpenSales(BRAND.id)
  return <CreditCollections brand={BRAND} creditSales={(q.data || []).filter((s) => s.is_credit && s.balance > 0)} clients={CLIENTS} role={role} perms={{}}
    loading={q.isLoading} error={q.isError} onRetry={() => q.refetch()} showToast={toast} />
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const dialog = () => document.querySelector('[role="dialog"]')
const button = (label, scope = document) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label) || b.getAttribute('aria-label') === label)
function type(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }
const submit = async (form) => { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush(); await flush() }

let sales
async function mount(role) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}><Screen role={role} /></QueryClientProvider>))
  await flush(); await flush()
}
beforeEach(async () => {
  sales = [
    { id: 's1', client_id: 'c1', client_name: 'Mama Ngozi', txn_no: 'TXN-1001', total: 5000, amount_paid: 1000, balance: 4000, is_credit: true, created_at: '2026-10-01T10:00:00', items: JSON.stringify([{ name: 'Amoxil', qty: 2 }]) },
    { id: 's3', client_id: 'c1', client_name: 'Mama Ngozi', txn_no: 'TXN-1003', total: 1500, amount_paid: 0, balance: 1500, is_credit: true, created_at: '2026-10-07T10:00:00' },
    { id: 's2', client_name: 'Obi Ada', txn_no: 'TXN-1002', total: 500, amount_paid: 0, balance: 500, is_credit: true, created_at: '2026-10-05T10:00:00' },
  ]
  repo.getOpen.mockReset().mockImplementation(async () => sales.map((s) => ({ ...s })))
  for (const f of [...Object.values(ledger), ...Object.values(clientsRepo)]) f.mockReset()
  ledger.getForSale.mockResolvedValue([])
  toast = vi.fn()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await mount()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; qc.clear() })

describe('POS credit accounts', () => {
  it('consolidates a customer\'s credit sales into one account with total outstanding and visits; search narrows', async () => {
    expect(text()).toContain('2 customer accounts · 3 credit sales')
    expect(text()).toContain('₦6,000 outstanding')
    const cards = [...host.querySelectorAll('button[aria-label^="Record payment:"]')].map((b) => b.getAttribute('aria-label'))
    expect(cards).toEqual(['Record payment: Mama Ngozi', 'Record payment: Obi Ada']) // largest balance first
    expect(text()).toContain('2 visits owing')
    expect(text()).toContain('₦5,500')
    await act(async () => type(host.querySelector('input[type="search"]'), '1002'))
    expect(text()).toContain('1 of 2 customer accounts match')
    expect(text()).not.toContain('Mama Ngozi')
    await act(async () => type(host.querySelector('input[type="search"]'), 'nobody'))
    expect(text()).toContain('No credit accounts match')
  })

  it('View details lists each visit with what it owes; a visit is paid on its own through the POS ledger', async () => {
    ledger.recordCollection.mockImplementation(async () => { sales[0] = { ...sales[0], amount_paid: 3000, balance: 2000 }; return { sale_id: 's1', applied: 2000, amount_paid: 3000, balance: 2000 } })
    await click(button('View details: Mama Ngozi'))
    expect(dialog().textContent).toContain('2 visits owing, oldest first')
    expect(dialog().textContent).toContain('TXN-1001')
    expect(dialog().textContent).toContain('Amoxil ×2')
    expect(dialog().textContent).toContain('Owed on this visit₦4,000')
    await click(button('Pay this visit', dialog()))
    await act(async () => type(document.querySelector('#credit-s1-amount'), '2000'))
    await submit(document.querySelector('#credit-s1-pay form'))
    expect(ledger.recordCollection).toHaveBeenCalledWith('s1', 2000, 'Cash')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Balance now ₦2,000'), { type: 'success' })
  })

  it('Record payment on the account is applied oldest first, all at once', async () => {
    ledger.recordAccountPayment.mockResolvedValue({ amount: 4500, allocations: [{ sale_id: 's1' }, { sale_id: 's3' }], balance: 1000 })
    await click(button('Record payment: Mama Ngozi'))
    expect(dialog().textContent).toContain('starting with TXN-1001, ₦4,000 owed')
    await act(async () => type(dialog().querySelector('input[type="number"]'), '4500'))
    await submit(dialog().querySelector('form'))
    expect(ledger.recordAccountPayment).toHaveBeenCalledWith('biz-1', ['s1', 's3'], 4500, 'Cash')
    expect(toast).toHaveBeenCalledWith('₦4,500 received from Mama Ngozi, applied to 2 visits. Balance now ₦1,000.', { type: 'success' })
    expect(dialog()).toBeNull()
  })

  it('more than the account owes is stopped before anything is sent', async () => {
    await click(button('Record payment: Mama Ngozi'))
    await act(async () => type(dialog().querySelector('input[type="number"]'), '5500.01'))
    await submit(dialog().querySelector('form'))
    expect(ledger.recordAccountPayment).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('more than the balance')
  })

  it('before the database update, an account payment that fits the oldest visit goes on it; a larger one says why not', async () => {
    ledger.recordAccountPayment.mockRejectedValue(new Error('Supabase error (404): PGRST202 Could not find the function public.record_customer_payment'))
    ledger.recordCollection.mockResolvedValue({ applied: 1000, balance: 3000 })
    await click(button('Record payment: Mama Ngozi'))
    await act(async () => type(dialog().querySelector('input[type="number"]'), '1000'))
    await submit(dialog().querySelector('form'))
    expect(ledger.recordCollection).toHaveBeenCalledWith('s1', 1000, 'Cash')
    await click(button('Record payment: Mama Ngozi'))
    await act(async () => type(dialog().querySelector('input[type="number"]'), '5000'))
    await submit(dialog().querySelector('form'))
    expect(dialog().textContent).toContain('Pay each visit from View details')
  })

  it('View transactions shows every purchase and payment of the customer, with the balance after each', async () => {
    clientsRepo.getSales.mockResolvedValue([
      { id: 's0', client_id: 'c1', txn_no: 'TXN-0900', total: 800, amount_paid: 800, balance: 0, is_credit: false, payment_method: 'Credit', created_at: '2026-09-01T10:00:00' },
      { id: 's9', client_id: 'c1', txn_no: 'TXN-0950', total: 300, amount_paid: 300, payment_method: 'Cash', created_at: '2026-09-02T10:00:00' },
    ])
    ledger.getForSales.mockResolvedValue([
      { id: 'p0', sale_id: 's0', kind: 'collection', method: 'Transfer', amount: 800, received_at: '2026-09-10T10:00:00', staff_name: 'Bisi' },
      { id: 'p1', sale_id: 's1', kind: 'sale', method: 'Cash', amount: 1000, received_at: '2026-10-01T10:00:00' },
    ])
    await click(button('View transactions: Mama Ngozi'))
    expect(clientsRepo.getSales).toHaveBeenCalledWith('c1', 'biz-1')
    expect(ledger.getForSales).toHaveBeenCalledWith('biz-1', expect.arrayContaining(['s0', 's1', 's3']))
    const rows = [...dialog().querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent))
    expect(rows.map((r) => [r[1], r[2].split(' ·')[0], r[3], r[4]])).toEqual([
      ['TXN-0900', 'Purchase on credit', '₦800', '₦800'],
      ['TXN-0900', 'Payment', '−₦800', '₦0'],
      ['TXN-1001', 'Purchase on credit', '₦5,000', '₦5,000'],
      ['TXN-1001', 'Paid at the sale', '−₦1,000', '₦4,000'],
      ['TXN-1003', 'Purchase on credit', '₦1,500', '₦5,500'],
    ])
    expect(dialog().textContent).not.toContain('TXN-0950') // a cash sale is not a credit transaction
  })

  it('export is offered to the Owner, not to a role without export permission', async () => {
    expect(button('Export')).toBeTruthy()
    await act(async () => root.unmount()); host.remove()
    await mount('Cashier')
    expect(button('Export')).toBeUndefined()
  })
})
