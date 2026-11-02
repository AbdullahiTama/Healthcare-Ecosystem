import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../../lib/authClient', () => ({ authClient: { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@x.com' } } }) } } }))

import RecordFields, { formatValue, humanizeKey, fieldsFromObject, flattenSections } from '../RecordFields.jsx'
import { useAuditedExport, exportWatermark } from '../AuditedExport.jsx'

let host, root
async function mount(el) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(el) })
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); document.body.innerHTML = ''; root = null })
const button = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent))
const typeInto = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('RecordFields helpers', () => {
  it('formats values for people', () => {
    expect(formatValue(true)).toBe('Yes')
    expect(formatValue(false)).toBe('No')
    expect(formatValue(['Ikeja', '', null, 'Yaba'])).toBe('Ikeja, Yaba')
    expect(formatValue({ years_experience: 3, notes: '' })).toBe('Years experience: 3')
    expect(formatValue('  ')).toBeNull()
    expect(formatValue(null)).toBeNull()
    expect(formatValue(0)).toBe('0')
    expect(formatValue('2026-10-20T10:00:00Z')).toMatch(/2026/)
  })

  it('turns free-form answers into fields, including keys added later', () => {
    expect(humanizeKey('requested_area')).toBe('Requested area')
    expect(fieldsFromObject({ motivation: 'Help', experience: '2y', secret: 'x' }, { exclude: ['secret'] })).toEqual([['Motivation', 'Help'], ['Experience', '2y']])
    expect(fieldsFromObject(null)).toEqual([])
  })

  it('flattens sections for the single-record export', () => {
    expect(flattenSections([{ title: 'Contact', fields: [['Phone', '080'], ['Email', null]] }])).toEqual([['Contact: Phone', '080'], ['Contact: Email', '']])
  })

  it('renders every field and marks empty ones', async () => {
    await mount(<RecordFields sections={[{ title: 'Location', fields: [['City', 'Ikeja'], ['Area', null]] }, { title: 'Empty', fields: [] }]} />)
    expect(host.querySelectorAll('dt')).toHaveLength(2)
    expect(host.textContent).toContain('Ikeja')
    expect(host.textContent).toContain('Not provided')
    expect(host.textContent).not.toContain('Empty')
  })
})

function Harness({ repository, run }) {
  const { requestExport, exportDialog } = useAuditedExport({ repository, getActor: async () => ({ id: 'u1', email: 'admin@x.com' }) })
  return <div><button onClick={() => requestExport({ exportType: 'admin.test.csv', label: 'test rows', rowCount: 2, run })}>Start export</button>{exportDialog}</div>
}

describe('useAuditedExport', () => {
  it('requires a reason, records the export, then produces the file', async () => {
    const repository = { logExport: vi.fn().mockResolvedValue([{ id: 1 }]) }
    const run = vi.fn()
    await mount(<Harness repository={repository} run={run} />)
    await act(async () => button(/Start export/).click())
    expect(document.body.textContent).toContain('2 records as CSV')
    await act(async () => button(/Record and export/).click())
    expect(document.body.textContent).toContain('at least 3 characters')
    expect(repository.logExport).not.toHaveBeenCalled()

    await typeInto(document.getElementById('admin-export-reason'), 'Board report')
    await act(async () => button(/Record and export/).click())
    expect(repository.logExport).toHaveBeenCalledWith(expect.objectContaining({ export_type: 'admin.test.csv', row_count: 2, reason: 'Board report', actor_admin_id: 'u1', watermark: expect.stringContaining('admin@x.com') }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Board report' }))
    expect(repository.logExport.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0])
    expect(document.body.textContent).not.toContain('Reason for export')
  })

  it('downloads nothing when the export cannot be recorded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const repository = { logExport: vi.fn().mockRejectedValue(new Error('Supabase error (403): denied')) }
    const run = vi.fn()
    await mount(<Harness repository={repository} run={run} />)
    await act(async () => button(/Start export/).click())
    await typeInto(document.getElementById('admin-export-reason'), 'Audit')
    await act(async () => button(/Record and export/).click())
    expect(run).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('could not be recorded, so nothing was downloaded')
  })

  it('watermarks with the actor and time', () => {
    expect(exportWatermark('a@x.com', new Date('2026-11-02T10:00:00Z'))).toBe('a@x.com · 2026-11-02T10:00:00.000Z')
    expect(exportWatermark(null, new Date('2026-11-02T10:00:00Z'))).toContain('platform admin')
  })
})
