import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../../lib/authClient', () => ({ authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.com' } } }) } } }))
const health = vi.hoisted(() => ({ logExport: vi.fn() }))
vi.mock('../../../../modules/health/repositories', () => ({ createHealthRepository: () => health }))
const exportsMock = vi.hoisted(() => ({ downloadCsv: vi.fn() }))
vi.mock('../../../../lib/carefindhubExports', async (orig) => ({ ...(await orig()), ...exportsMock }))

import RevenueOverview from '../RevenueOverview.jsx'

const day = (d) => new Date(Date.now() + d * 86400000).toISOString()
let host, root, repository
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<RevenueOverview repository={repository} />) })
  await flush()
}
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent))

beforeEach(() => {
  window.innerWidth = 1280
  repository = {
    getSettledPlanPayments: vi.fn().mockResolvedValue([{ id: 'p1', business_id: 'b1', status: 'success', months: 12, naira_amount: 60000, plan: 'basic', payment_method: 'paystack', paid_at: day(-2), period_start: day(-2), period_end: day(363), receipt_number: 'CH-2026-000001', reference: 'ch_plan_1' }]),
    getSubscriptionOverview: vi.fn().mockResolvedValue([
      { business_id: 'b1', name: 'Ada Pharmacy', plan: 'basic', plan_state: 'active', suspended: false, access_type: 'paid', expires_at: day(363), payment_count: 1, last_payment_amount: 60000 },
      { business_id: 'b2', name: 'Bola Clinic', plan: 'growth', plan_state: 'grace', suspended: false, access_type: 'none', expires_at: day(-3), payment_count: 0 },
    ]),
  }
  health.logExport.mockReset().mockResolvedValue([{ id: 1 }]); exportsMock.downloadCsv.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Revenue overview', () => {
  it('shows collected money and current earnings from real payments', async () => {
    await mount()
    expect(host.textContent).toContain('₦60,000')
    expect(host.textContent).toContain('₦5,000') // 60,000 ÷ 12 months earning now
    expect(host.textContent).toContain('1 of 2')
    expect(host.textContent).toContain('CH-2026-000001')
    expect(host.textContent).toContain('Ada Pharmacy')
    expect(host.textContent).not.toMatch(/plan_catalog|dunning/)
  })

  it('every month is reachable as text, and the table view lists all 12', async () => {
    await mount()
    const bars = host.querySelectorAll('[role="listitem"]')
    expect(bars).toHaveLength(12)
    const withPayment = [...bars].filter(b => /₦60,000 from 1 payment$/.test(b.getAttribute('aria-label')))
    expect(withPayment).toHaveLength(1)
    expect([...bars].filter(b => /₦0 from 0 payments$/.test(b.getAttribute('aria-label')))).toHaveLength(11)
    await act(async () => withPayment[0].dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(host.querySelector('[role="tooltip"]').textContent).toContain('₦60,000')
    await act(async () => button(/Show table/).click())
    expect(host.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(12)
  })

  it('exports payments only after a reason is recorded', async () => {
    await mount()
    await act(async () => button(/Export payments/).click())
    const reason = document.getElementById('admin-export-reason')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    await act(async () => { setter.call(reason, 'Monthly finance review'); reason.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => button(/Record and export/).click())
    await flush()
    expect(health.logExport).toHaveBeenCalledWith(expect.objectContaining({ export_type: 'admin.plan_payments.csv', row_count: 1 }))
    expect(exportsMock.downloadCsv.mock.calls[0][1]).toContain('Ada Pharmacy')
  })

  it('shows empty and error states', async () => {
    repository.getSettledPlanPayments.mockResolvedValue([])
    await mount()
    expect(host.textContent).toContain('No plan payments yet')
    expect(host.textContent).toContain('No plan payments in the last 12 months')
    await act(async () => root.unmount()); host.remove()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.getSubscriptionOverview.mockRejectedValue(new Error('Supabase error (500): unavailable'))
    await mount()
    expect(host.textContent).toContain('unavailable')
  })
})
