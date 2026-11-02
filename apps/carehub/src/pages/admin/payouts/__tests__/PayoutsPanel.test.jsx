import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../../lib/authClient', () => ({ authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.com' } } }) } } }))
const health = vi.hoisted(() => ({ logExport: vi.fn() }))
vi.mock('../../../../modules/health/repositories', () => ({ createHealthRepository: () => health }))
const exportsMock = vi.hoisted(() => ({ downloadCsv: vi.fn() }))
vi.mock('../../../../lib/carefindhubExports', async (orig) => ({ ...(await orig()), ...exportsMock }))

import PayoutsPanel from '../PayoutsPanel.jsx'

let host, root, service
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<PayoutsPanel service={service} />) })
  await flush()
}
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') || ''))
async function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  service = {
    getPayoutRequests: vi.fn().mockResolvedValue([{ id: 'p1234567-x', requester_type: 'agent', requester_id: 'ag1', amount: 25000, status: 'processing', bank_name: 'GTBank', account_number: '0123456789', account_name: 'Musa Bello', requested_at: '2026-10-30T09:00:00Z', notes: 'October commissions' }]),
    updatePayoutRequest: vi.fn().mockResolvedValue(null), markPayoutPaidAtomic: vi.fn().mockResolvedValue(null),
  }
  health.logExport.mockReset().mockResolvedValue([{ id: 1 }]); exportsMock.downloadCsv.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('PayoutsPanel', () => {
  it('masks the account in the list and shows it in full in the open request', async () => {
    await mount()
    expect(host.textContent).toContain('•••• 6789')
    expect(host.textContent).not.toContain('0123456789')
    await act(async () => button(/Open payout request/).click())
    const sheet = document.querySelector('.ds-sheet-panel')
    expect(sheet.textContent).toContain('0123456789')
    expect(sheet.textContent).toContain('October commissions')
  })

  it('confirms before marking paid, then updates the financial source', async () => {
    await mount()
    await act(async () => button(/Mark as Paid/).click())
    expect(document.body.textContent).toContain('Only confirm once the money has been sent')
    await act(async () => button(/Confirm Paid/).click())
    await flush()
    expect(service.markPayoutPaidAtomic).toHaveBeenCalledWith('p1234567-x', {})
    expect(service.updatePayoutRequest).toHaveBeenCalledWith('p1234567-x', expect.objectContaining({ status: 'paid' }))
  })

  it('exports the list with masked accounts after a reason', async () => {
    await mount()
    await act(async () => button(/^Export$/).click())
    await typeInto(document.getElementById('admin-export-reason'), 'Month-end reconciliation')
    await act(async () => button(/Record and export/).click())
    await flush()
    const csv = exportsMock.downloadCsv.mock.calls[0][1]
    expect(csv).toContain('•••• 6789')
    expect(csv).not.toContain('0123456789')
  })

  it('shows an error state when requests cannot load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.getPayoutRequests.mockRejectedValue(new Error('Supabase error (500): down'))
    await mount()
    expect(host.textContent).toContain('down')
  })
})
