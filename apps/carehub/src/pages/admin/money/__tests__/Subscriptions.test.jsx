import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../../lib/authClient', () => ({ authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.com' } } }) } } }))
const exportsMock = vi.hoisted(() => ({ downloadCsv: vi.fn() }))
vi.mock('../../../../lib/carefindhubExports', async (orig) => ({ ...(await orig()), ...exportsMock }))
const health = vi.hoisted(() => ({ logExport: vi.fn() }))
vi.mock('../../../../modules/health/repositories', () => ({ createHealthRepository: () => health }))

import Subscriptions from '../Subscriptions.jsx'

const future = (days) => new Date(Date.now() + days * 86400000).toISOString()
const rows = () => [
  { business_id: 'b1', name: 'Ada Pharmacy', owner_name: 'Ada', email: 'ada@x.com', plan: 'basic', plan_state: 'active', suspended: false, access_type: 'paid', expires_at: future(60), period_start: future(-30), payment_count: 1, total_paid: 5000, last_payment_amount: 5000, branch_count: 0 },
  { business_id: 'b2', name: 'Bola Clinic', owner_name: 'Bola', email: 'bola@x.com', plan: 'growth', plan_state: 'restricted', suspended: false, access_type: 'none', expires_at: future(-20), payment_count: 0, total_paid: 0, branch_count: 2 },
]

let host, root, repository
async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<Subscriptions repository={repository} />) })
  await flush()
}
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') || ''))
async function typeInto(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}

beforeEach(() => {
  window.innerWidth = 1280
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  repository = {
    getSubscriptionOverview: vi.fn().mockResolvedValue(rows()),
    getSubscriptionHistory: vi.fn().mockResolvedValue([
      { kind: 'payment', occurred_at: future(-30), action: 'payment', plan_after: 'basic', months: 1, amount: 5000, payment_method: 'paystack', receipt_number: 'CH-2026-000001', expires_after: future(0) },
    ]),
    manageSubscription: vi.fn().mockResolvedValue({ plan: 'premium' }),
  }
  health.logExport.mockReset().mockResolvedValue([{ id: 1 }])
  exportsMock.downloadCsv.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Subscriptions admin', () => {
  it('lists every business with plan, state, payment status and expiry', async () => {
    await mount()
    expect(host.textContent).toContain('Ada Pharmacy')
    expect(host.textContent).toContain('Bola Clinic')
    expect(host.textContent).toContain('Overdue — restricted')
    expect(host.textContent).toContain('Paid')
    expect(host.textContent).toContain('2 of 2 businesses')
  })

  it('filters from the summary chips and the search box', async () => {
    await mount()
    await act(async () => button(/^Restricted/).click())
    expect(host.textContent).not.toContain('Ada Pharmacy')
    expect(host.textContent).toContain('Bola Clinic')
    await act(async () => button(/^All/).click())
    await typeInto(host.querySelector('input[aria-label="Search subscriptions"]'), 'ada')
    expect(host.textContent).toContain('Ada Pharmacy')
    expect(host.textContent).not.toContain('Bola Clinic')
  })

  it('opens a business: details, history, and an audited plan change', async () => {
    await mount()
    await act(async () => button(/^Ada Pharmacy$/).click())
    await flush()
    const dialog = document.querySelector('.ds-sheet-panel')
    expect(dialog.textContent).toContain('How access was obtained')
    expect(dialog.textContent).toContain('CH-2026-000001')
    expect(repository.getSubscriptionHistory).toHaveBeenCalledWith('b1')

    await typeInto(document.getElementById('sub-plan'), 'premium')
    await act(async () => button(/Review change/).click())
    expect(dialog.textContent).toContain('at least 3 characters')
    expect(repository.manageSubscription).not.toHaveBeenCalled()

    await typeInto(document.getElementById('sub-reason'), 'Upgrade agreed with owner')
    await act(async () => button(/Review change/).click())
    expect(document.body.textContent).toContain('Basic → Premium')
    await act(async () => button(/Confirm change plan/).click())
    await flush()
    expect(repository.manageSubscription).toHaveBeenCalledWith({ businessId: 'b1', action: 'change_plan', reason: 'Upgrade agreed with owner', plan: 'premium' })
    expect(repository.getSubscriptionOverview).toHaveBeenCalledTimes(2)
  })

  it('shows the database refusal and keeps the sheet open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.manageSubscription.mockRejectedValue(new Error('Supabase error (400): This subscription is already suspended'))
    await mount()
    await act(async () => button(/^Ada Pharmacy$/).click())
    await flush()
    await act(async () => [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Suspend').click())
    await typeInto(document.getElementById('sub-reason'), 'Chargeback dispute')
    await act(async () => button(/Review change/).click())
    await act(async () => button(/Confirm suspend/).click())
    await flush()
    expect(document.querySelector('.ds-sheet-panel').textContent).toContain('This subscription is already suspended')
  })

  it('exports the filtered list only after a reason is recorded', async () => {
    await mount()
    await act(async () => button(/^Export$/).click())
    await typeInto(document.getElementById('admin-export-reason'), 'Monthly revenue review')
    await act(async () => button(/Record and export/).click())
    await flush()
    expect(health.logExport).toHaveBeenCalledWith(expect.objectContaining({ export_type: 'admin.subscriptions.csv', row_count: 2, reason: 'Monthly revenue review' }))
    expect(exportsMock.downloadCsv).toHaveBeenCalledWith(expect.stringMatching(/^subscriptions_\d{4}-\d{2}-\d{2}\.csv$/), expect.stringContaining('Ada Pharmacy'))
  })

  it('explains when the database update has not been applied', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.getSubscriptionOverview.mockRejectedValue(new Error('Supabase error (404): Could not find the function public.admin_subscription_overview'))
    await mount()
    expect(host.textContent).toContain('carehub_20261230_admin_subscription_management')
  })

  it('shows an empty state with no businesses', async () => {
    repository.getSubscriptionOverview.mockResolvedValue([])
    await mount()
    expect(host.textContent).toContain('No businesses yet')
  })
})
