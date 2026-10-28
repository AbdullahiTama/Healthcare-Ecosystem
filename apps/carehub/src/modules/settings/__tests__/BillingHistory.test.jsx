import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getBillingOverview: vi.fn() }))
const billing = vi.hoisted(() => ({ confirmPlanPayment: vi.fn(), printReceipt: vi.fn(() => true) }))
vi.mock('../repositories', () => ({ settingsRepository: repo }))
vi.mock('../services/billing', async (orig) => ({ ...(await orig()), ...billing }))

import BillingHistory from '../BillingHistory.jsx'

const overview = (over = {}) => ({
  business: { id: 'b1', name: 'Ada Pharmacy' }, plan: 'basic', limits: { staff: 5, locations: 2, products: 5000 },
  usage: { staff: 5, locations: 1, products: 10 },
  payments: [{ id: 'p1', receipt_number: 'CH-2026-000001', reference: 'ch_plan_a', plan: 'basic', months: 1, amount: 5000, payment_method: 'paystack', provider_transaction_id: '99', period_start: '2026-10-11', period_end: '2026-11-11', paid_at: '2026-10-11' }],
  attempts: [{ reference: 'ch_plan_b', status: 'failed', purpose: 'plan_renewal', amount: 50000, months: 12, plan: 'basic', created_at: '2026-10-20' }],
  ...over,
})

let host, root, toast, onRenewed
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<BillingHistory businessId='b1' reloadKey={0} onRenewed={onRenewed} showToast={toast} />) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent))

beforeEach(() => { repo.getBillingOverview.mockReset(); billing.confirmPlanPayment.mockReset(); billing.printReceipt.mockClear(); toast = vi.fn(); onRenewed = vi.fn() })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('BillingHistory', () => {
  it('shows usage, payments with receipts, and attempts', async () => {
    repo.getBillingOverview.mockResolvedValue(overview())
    await mount()
    expect(repo.getBillingOverview).toHaveBeenCalledWith('b1')
    expect(host.textContent).toContain('5 / 5')
    expect(host.textContent).toContain('Limit reached')
    expect(host.textContent).toContain('CH-2026-000001')
    expect(host.textContent).toContain('Not completed')
  })

  it('opens a receipt and prints it', async () => {
    repo.getBillingOverview.mockResolvedValue(overview())
    await mount()
    await act(async () => button(/^View receipt$/).click())
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Paystack transaction ID')
    await act(async () => button(/^Print receipt$/).click())
    expect(billing.printReceipt).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), expect.objectContaining({ name: 'Ada Pharmacy' }))
  })

  it('"Check payment" confirms with Paystack, tells the parent and reloads', async () => {
    repo.getBillingOverview.mockResolvedValue(overview())
    billing.confirmPlanPayment.mockResolvedValue({ credited: true, newExpiry: '2027-11-11' })
    await mount()
    await act(async () => { button(/Check payment/).click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(billing.confirmPlanPayment).toHaveBeenCalledWith('ch_plan_b')
    expect(onRenewed).toHaveBeenCalledWith('2027-11-11')
    expect(repo.getBillingOverview).toHaveBeenCalledTimes(2)
  })

  it('says plainly when Paystack has no payment', async () => {
    repo.getBillingOverview.mockResolvedValue(overview())
    billing.confirmPlanPayment.mockRejectedValue(new Error('Payment not confirmed by Paystack'))
    await mount()
    await act(async () => { button(/Check payment/).click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(toast.mock.calls[0][0]).toContain('You were not charged')
    expect(onRenewed).not.toHaveBeenCalled()
  })

  it('empty and error states', async () => {
    repo.getBillingOverview.mockResolvedValue(overview({ payments: [], attempts: [] }))
    await mount()
    expect(host.textContent).toContain('No payments yet')
    expect(host.textContent).not.toContain('Unconfirmed attempts')
    await act(async () => root.unmount()); host.remove()

    repo.getBillingOverview.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(overview())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()
    expect(host.textContent).toContain("couldn't load your billing history")
    await act(async () => button(/retry|try again/i).click())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(host.textContent).toContain('CH-2026-000001')
  })
})
