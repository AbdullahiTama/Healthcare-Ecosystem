import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getOpen: vi.fn(), recordPayment: vi.fn(), getPayments: vi.fn() }))
vi.mock('./repositories', () => ({ saleRepository: repo }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))

import CreditCollections from './CreditCollections.jsx'
import { useOpenSales } from '../../hooks/queries'

const BRAND = { id: 'biz-1' }
let host, root, qc, toast

function Screen() {
  const q = useOpenSales(BRAND.id)
  return <CreditCollections brand={BRAND} creditSales={(q.data || []).filter((s) => s.is_credit && s.balance > 0)} loading={q.isLoading}
    error={q.isError} onRetry={() => q.refetch()} staffName='Ada' showToast={toast} />
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => host.textContent
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label))
function type(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

let sales
beforeEach(async () => {
  sales = [
    { id: 's1', client_name: 'Mama Ngozi', txn_no: 'TXN-1001', total: 5000, amount_paid: 1000, balance: 4000, is_credit: true, created_at: '2026-10-01T10:00:00' },
    { id: 's2', client_name: 'Obi Ada', txn_no: 'TXN-1002', total: 500, amount_paid: 0, balance: 500, is_credit: true, created_at: '2026-10-05T10:00:00' },
  ]
  repo.getOpen.mockReset().mockImplementation(async () => sales.map((s) => ({ ...s })))
  repo.recordPayment.mockReset()
  repo.getPayments.mockReset().mockResolvedValue([])
  toast = vi.fn()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<QueryClientProvider client={qc}><Screen /></QueryClientProvider>))
  await flush(); await flush()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear() })

describe('POS credit collections', () => {
  it('shows every open credit sale with the total outstanding, and search narrows it', async () => {
    expect(text()).toContain('2 credit sales')
    expect(text()).toContain('₦4,500')
    await act(async () => type(host.querySelector('input[type="search"]'), '1002'))
    expect(text()).toContain('1 of 2 credit sales match')
    expect(text()).toContain('Obi Ada')
    expect(text()).not.toContain('Mama Ngozi')
    await act(async () => type(host.querySelector('input[type="search"]'), 'nobody'))
    expect(text()).toContain('No credit sales match')
  })

  it('records a partial payment; the balance updates without a reload', async () => {
    // Newest first, so the first card is Obi Ada's (balance 500).
    repo.recordPayment.mockImplementation(async () => { sales[1] = { ...sales[1], amount_paid: 200, balance: 300 }; return { amount: 200, amount_paid: 200, balance: 300 } })
    await act(async () => button('Record payment').click())
    await act(async () => type(host.querySelector('#credit-s2-amount'), '200'))
    await act(async () => type(host.querySelector('#credit-s2-method'), 'Transfer'))
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush(); await flush()
    expect(repo.recordPayment).toHaveBeenCalledWith('s2', { amount: 200, method: 'Transfer', staffName: 'Ada' })
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Balance now ₦300'), { type: 'success' })
    expect(text()).toContain('₦4,300') // total outstanding: 4,000 + 300
  })

  it('"Full balance" fills the amount; a refused payment shows the reason by the field', async () => {
    repo.recordPayment.mockRejectedValue(new Error('Supabase error (400): The amount is more than the balance of 500.00.'))
    await act(async () => button('Record payment').click())
    await act(async () => button('Full balance').click())
    expect(host.querySelector('#credit-s2-amount').value).toBe('500')
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(host.querySelector('#credit-s2-amount-error').textContent).toContain('more than the balance of 500.00')
  })

  it('an amount over the balance is stopped before anything is sent', async () => {
    await act(async () => button('Record payment').click())
    await act(async () => type(host.querySelector('#credit-s2-amount'), '500.5'))
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(repo.recordPayment).not.toHaveBeenCalled()
    expect(text()).toContain('more than the balance')
  })
})
