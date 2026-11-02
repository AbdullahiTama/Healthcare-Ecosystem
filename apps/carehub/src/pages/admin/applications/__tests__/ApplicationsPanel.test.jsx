import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../../lib/authClient', () => ({ authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.com' } } }) } } }))
const health = vi.hoisted(() => ({ logExport: vi.fn() }))
vi.mock('../../../../modules/health/repositories', () => ({ createHealthRepository: () => health }))
const exportsMock = vi.hoisted(() => ({ downloadCsv: vi.fn() }))
vi.mock('../../../../lib/carefindhubExports', async (orig) => ({ ...(await orig()), ...exportsMock }))

import ApplicationsPanel from '../ApplicationsPanel.jsx'

let host, root, service
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<ApplicationsPanel service={service} businesses={[]} />) })
  await flush()
}
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') || ''))
async function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  service = {
    getApplications: vi.fn().mockResolvedValue([]),
    getAgentApplications: vi.fn().mockResolvedValue([{ id: 'a1', applicant_name: 'Musa Bello', contact_email: 'musa@x.com', contact_phone: '0803', requested_city: 'Kano', requested_area: 'Fagge, Gwale', applicant_details: { motivation: 'Serve my community' }, status: 'submitted', submitted_at: '2026-10-30T09:00:00Z' }]),
    sbFetch: vi.fn().mockResolvedValue([{ id: 'e1', business_id: 'b1', status: 'pending', created_at: '2026-10-29T09:00:00Z', seller_info: {} }]),
    reviewAgentApplication: vi.fn().mockResolvedValue(null),
    reviewApplication: vi.fn(), updateBusiness: vi.fn(), addAgentRow: vi.fn(),
  }
  health.logExport.mockReset().mockResolvedValue([{ id: 1 }]); exportsMock.downloadCsv.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('ApplicationsPanel', () => {
  it('opens an ambassador application with every submitted detail', async () => {
    await mount()
    await act(async () => button(/Open Ambassador \(agent\) application from Musa Bello/).click())
    const sheet = document.querySelector('.ds-sheet-panel')
    for (const text of ['musa@x.com', '0803', 'Kano', 'Fagge, Gwale', 'Serve my community', 'Selected areas']) expect(sheet.textContent).toContain(text)
  })

  it('requires a reason to reject and saves it on the application', async () => {
    await mount()
    await act(async () => button(/Musa Bello/).click())
    await act(async () => button(/Reject/).click())
    expect(service.reviewAgentApplication).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Say why the application is rejected')
    await typeInto(document.getElementById('application-review-notes'), 'Area already covered')
    await act(async () => button(/Reject/).click())
    await flush()
    expect(service.reviewAgentApplication).toHaveBeenCalledWith('a1', expect.objectContaining({ status: 'rejected', review_notes: 'Area already covered' }))
  })

  it('keeps store-flow applications view-only (no false "approved")', async () => {
    await mount()
    await act(async () => button(/Open Online store application/).click())
    expect(button(/^\s*Approve$/)).toBeUndefined()
    expect(document.body.textContent).toContain('CareFind Admin › Shop')
  })

  it('exports one application after a reason is recorded', async () => {
    await mount()
    await act(async () => button(/Musa Bello/).click())
    await act(async () => [...document.querySelectorAll('.ds-sheet-panel button')].find(b => /Export/.test(b.textContent)).click())
    await typeInto(document.getElementById('admin-export-reason'), 'Field team onboarding')
    await act(async () => button(/Record and export/).click())
    await flush()
    expect(health.logExport).toHaveBeenCalledWith(expect.objectContaining({ export_type: 'admin.application.csv', row_count: 1 }))
    expect(exportsMock.downloadCsv.mock.calls[0][1]).toContain('Serve my community')
  })

  it('warns when a source fails and errors when all fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.sbFetch.mockRejectedValue(new Error('boom'))
    await mount()
    expect(host.textContent).toContain('may be incomplete')
    await act(async () => root.unmount()); host.remove()
    service.getApplications.mockRejectedValue(new Error('x')); service.getAgentApplications.mockRejectedValue(new Error('x'))
    await mount()
    expect(host.textContent).toContain('Applications could not be loaded')
  })
})
