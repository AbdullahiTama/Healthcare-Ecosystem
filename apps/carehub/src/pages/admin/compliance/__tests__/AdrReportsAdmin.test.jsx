import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../../lib/authClient', () => ({ authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.com' } } }) } } }))
const health = vi.hoisted(() => ({ logExport: vi.fn() }))
vi.mock('../../../../modules/health/repositories', () => ({ createHealthRepository: () => health }))
const exportsMock = vi.hoisted(() => ({ downloadTextFile: vi.fn(), openPrintView: vi.fn(() => true) }))
vi.mock('../../../../modules/adr/exports', async (orig) => ({ ...(await orig()), ...exportsMock }))

import AdrReportsAdmin, { caseDocument } from '../AdrReportsAdmin.jsx'

const summary = (over = {}) => ({ report_id: 'r1', report_number: 'ADR-2026-000001', status: 'submitted', module_type: 'community_pharmacy', report_source: 'public', business_id: null, reporter_facility_name: 'Corner Chemist', created_at: '2026-10-20T10:00:00Z', ...over })
const full = () => ({
  ...summary(), patient_identifier: 'JD', patient_age: 34, reporter_name: 'Dr Ada', reaction_expected: false,
  adr_products: [{ product_brand_name: 'Ampiclox', batch_lot_number: 'B12' }],
  adr_reactions: [{ reaction_description: 'Rash', severity: 'mild' }],
  adr_concomitant_meds: [{ name: '<img src=x onerror=alert(1)>', dose: '5mg' }],
  adr_evidence_photos: [{ photo_id: 'p1', evidence_photo_file: 'https://cdn.example/photo.jpg' }, { photo_id: 'p2', evidence_photo_file: 'javascript:alert(1)' }],
})

let host, root, repository
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount(props = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<AdrReportsAdmin repository={repository} businesses={[{ id: 'b1', name: 'Ada Pharmacy' }]} {...props} />) })
  await flush(); await flush()
}
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent) || re.test(b.getAttribute('aria-label') || ''))
async function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  window.innerWidth = 1280
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  repository = {
    getPlatformReports: vi.fn().mockResolvedValue([summary(), summary({ report_id: 'r2', report_number: 'ADR-2026-000002', business_id: 'b1', report_source: 'business_facility', status: 'follow_up_required' })]),
    getReportWithDetails: vi.fn().mockResolvedValue(full()),
    logEvent: vi.fn().mockResolvedValue(null),
  }
  health.logExport.mockReset().mockResolvedValue([{ id: 1 }])
  exportsMock.downloadTextFile.mockReset(); exportsMock.openPrintView.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('ADR Reports admin', () => {
  it('lists platform reports with business names, excluding drafts by default', async () => {
    await mount()
    expect(repository.getPlatformReports).toHaveBeenCalledWith({ status: undefined, source: undefined, moduleType: undefined, search: undefined })
    expect(host.textContent).toContain('Corner Chemist')
    expect(host.textContent).toContain('Ada Pharmacy')
    expect(host.textContent).toContain('2 reports')
  })

  it('opens the full case in a script-free frame, with only safe photo links', async () => {
    await mount()
    await act(async () => button(/Open ADR-2026-000001|^ADR-2026-000001$/).click())
    await flush()
    expect(repository.getReportWithDetails).toHaveBeenCalledWith('r1')
    const frame = document.querySelector('iframe')
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('srcdoc')).toContain('Ampiclox')
    expect(frame.getAttribute('srcdoc')).not.toContain('<img src=x')
    const links = [...document.querySelectorAll('.ds-sheet-panel a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['https://cdn.example/photo.jpg'])
  })

  it('records a reason before exporting one case, and notes it on the case timeline', async () => {
    await mount()
    await act(async () => button(/^ADR-2026-000001$/).click())
    await flush()
    await act(async () => button(/E2B XML/).click())
    await typeInto(document.getElementById('admin-export-reason'), 'NAFDAC submission')
    await act(async () => button(/Record and export/).click())
    await flush()
    expect(health.logExport).toHaveBeenCalledWith(expect.objectContaining({ export_type: 'admin.adr_report.e2b.xml', row_count: 1, reason: 'NAFDAC submission' }))
    expect(exportsMock.downloadTextFile).toHaveBeenCalledWith('ADR-2026-000001.xml', expect.stringContaining('<ichicsr'))
    expect(repository.logEvent).toHaveBeenCalledWith('r1', 'exported', expect.objectContaining({ format: 'e2b-xml', via: 'platform-admin' }))
  })

  it('exports the list as CSV without reporter identity', async () => {
    await mount()
    await act(async () => button(/^CSV$/).click())
    await typeInto(document.getElementById('admin-export-reason'), 'Quarterly signal review')
    await act(async () => button(/Record and export/).click())
    await flush(); await flush()
    const [name, csv] = exportsMock.downloadTextFile.mock.calls[0]
    expect(name).toMatch(/^adr-reports_\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv).toContain('Ampiclox')
    expect(csv).not.toContain('reporter_name')
    expect(csv).not.toContain('Dr Ada')
    expect(repository.logEvent).toHaveBeenCalledTimes(2)
  })

  it('shows empty and error states', async () => {
    repository.getPlatformReports.mockResolvedValue([])
    await mount()
    expect(host.textContent).toContain('No adverse drug reaction reports have been submitted yet')
    await act(async () => root.unmount()); host.remove()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.getPlatformReports.mockRejectedValue(new Error('Supabase error (500): boom'))
    await mount()
    expect(host.textContent).toContain('boom')
  })

  it('the case document escapes reporter-typed text', () => {
    const html = caseDocument({ report: full(), products: [], meds: full().adr_concomitant_meds, reactions: [] })
    expect(html).not.toContain('<img src=x')
  })
})
