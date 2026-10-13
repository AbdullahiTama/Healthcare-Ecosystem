import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

// The hook records every set of params it is called with and returns whatever
// query-like result the test has set.
const audit = vi.hoisted(() => ({ calls: [], result: null }))
const csv = vi.hoisted(() => ({ exportCSV: vi.fn() }))

vi.mock('../hooks/useAuditLog', () => ({ useAuditLog: (params) => { audit.calls.push(params); return audit.result } }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => ({ confirming: false }) }))
vi.mock('../ui', async (importActual) => ({ ...(await importActual()), exportCSV: csv.exportCSV }))

import AuditLogSection from './AuditLogSection.jsx'

const hour = 3600000
const MARKUP = '<img src=x onerror=alert(1)>'
const logs = [
  { id: 'a1', actor_name: 'Ada Obi', action: 'bulk_delete', target_type: 'post', target_id: 'p-1', metadata: { count: 3, note: MARKUP }, created_at: new Date(Date.now() - 2 * hour).toISOString() },
  { id: 'a2', actor_name: null, action: 'approve', target_type: 'verification', metadata: 'Approved by hand', created_at: new Date(Date.now() - 30 * hour).toISOString() },
  { id: 'a3', actor_name: 'Bayo Ade', action: 'reject', target_type: 'claim', metadata: 'x'.repeat(70), created_at: new Date(Date.now() - 50 * hour).toISOString() },
  { id: 'a4', actor_name: 'Ada Obi', action: 'resolve', target_type: 'report', metadata: null, created_at: null },
]
const ok = (over = {}, data = {}) => ({
  data: { rows: logs, hasNext: true, capped: false, ...data },
  isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...over,
})
const last = () => audit.calls[audit.calls.length - 1]
const NONE = { action: 'all', targetType: 'all', dateFrom: '', dateTo: '', page: 0 }
const actorBox = () => screen.getByRole('textbox', { name: 'Filter loaded rows by actor…' })
const openRow = (label) => {
  fireEvent.click(screen.getByRole('button', { name: `Review ${label}` }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  audit.calls = []
  audit.result = ok()
  csv.exportCSV.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('AuditLogSection', () => {
  it('has one h1 and starts unfiltered on page 0', () => {
    render(<AuditLogSection />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument()
    expect(last()).toEqual(NONE)
  })

  it('shows the loading state', () => {
    audit.result = ok({ isLoading: true, data: undefined })
    render(<AuditLogSection />)
    expect(screen.queryByText(/No audit log entries/)).not.toBeInTheDocument()
    expect(screen.queryByText('Ada Obi')).not.toBeInTheDocument()
  })

  it("a failed list shows Couldn't load and Retry, never the empty message", () => {
    const refetch = vi.fn()
    audit.result = ok({ isError: true, data: undefined, refetch })
    render(<AuditLogSection />)
    expect(screen.getByText(/Couldn't load/)).toBeInTheDocument()
    expect(screen.queryByText(/No audit log entries/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('an empty successful list says there are no audit log entries', () => {
    audit.result = ok({}, { rows: [], hasNext: false })
    render(<AuditLogSection />)
    expect(screen.getByText(/No audit log entries/)).toBeInTheDocument()
  })

  it('renders actor, action with spaces, target, relative time and a details excerpt', () => {
    render(<AuditLogSection />)
    const [, first, second, third, fourth] = screen.getAllByRole('row')
    expect(within(first).getByText('Ada Obi')).toBeInTheDocument()
    expect(within(first).getByText('bulk delete')).toBeInTheDocument()
    expect(within(first).getByText('post')).toBeInTheDocument()
    expect(within(first).getByText('2h ago')).toBeInTheDocument()
    // A missing actor is Unknown; a string detail is shown as is.
    expect(within(second).getByText('Unknown')).toBeInTheDocument()
    expect(within(second).getByText('Approved by hand')).toBeInTheDocument()
    // Details are cut at 60 characters with an ellipsis.
    expect(within(third).getByText(`${'x'.repeat(60)}…`)).toBeInTheDocument()
    // No details and no date are dashes, not invented values.
    expect(within(fourth).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('colours the dot per action with classes, not inline colours', () => {
    audit.result = ok({}, { rows: [
      { id: 'd', actor_name: 'D', action: 'suspend', target_type: 'user' },
      { id: 's', actor_name: 'S', action: 'bulk_approve', target_type: 'post' },
      { id: 'w', actor_name: 'W', action: 'bulk_reject', target_type: 'post' },
      { id: 'i', actor_name: 'I', action: 'resolve', target_type: 'report' },
    ] })
    render(<AuditLogSection />)
    const dotOf = (name) => screen.getByRole('button', { name: `Review ${name}` }).closest('tr').querySelector('.adm-audit-dot')
    expect(dotOf('D suspend')).toHaveClass('adm-audit-dot--danger')
    expect(dotOf('S bulk approve')).toHaveClass('adm-audit-dot--success')
    expect(dotOf('W bulk reject')).toHaveClass('adm-audit-dot--warning')
    expect(dotOf('I resolve')).toHaveClass('adm-audit-dot--info')
    expect(dotOf('D suspend').getAttribute('style')).toBeNull()
  })

  it('the drawer shows metadata as pretty JSON text and markup stays inert', () => {
    render(<AuditLogSection />)
    const dialog = openRow('Ada Obi bulk delete')
    expect(within(dialog).getByText('bulk delete · post')).toBeInTheDocument()
    const pre = dialog.querySelector('pre')
    expect(pre.textContent).toBe(JSON.stringify(logs[0].metadata, null, 2))
    expect(pre.textContent).toContain(MARKUP)
    expect(dialog.querySelectorAll('img')).toHaveLength(0)
  })

  it('the drawer shows a string as is and says so when there are no details', () => {
    const { unmount } = render(<AuditLogSection />)
    expect(openRow('Unknown approve').querySelector('pre').textContent).toBe('Approved by hand')
    unmount()
    render(<AuditLogSection />)
    const dialog = openRow('Ada Obi resolve')
    expect(within(dialog).getByText('No details recorded')).toBeInTheDocument()
    expect(dialog.querySelector('pre')).toBeNull()
  })

  it('the action pills filter on the server and return to page 0', () => {
    render(<AuditLogSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    const pills = screen.getByRole('group', { name: 'Action' })
    fireEvent.click(within(pills).getByRole('button', { name: 'Rejected' }))
    expect(last()).toEqual({ ...NONE, action: 'reject' })
    expect(within(pills).getByRole('button', { name: 'Rejected' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('the target type pills filter on the server and return to page 0', () => {
    render(<AuditLogSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Target type' })).getByRole('button', { name: 'Claims' }))
    expect(last()).toEqual({ ...NONE, targetType: 'claim' })
  })

  it('the date inputs pass dateFrom and dateTo and return to page 0', () => {
    render(<AuditLogSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const group = within(screen.getByRole('group', { name: 'Date range' }))
    fireEvent.change(group.getByLabelText('From'), { target: { value: '2026-10-01' } })
    expect(last()).toEqual({ ...NONE, dateFrom: '2026-10-01' })
    fireEvent.change(group.getByLabelText('To'), { target: { value: '2026-10-09' } })
    expect(last()).toEqual({ ...NONE, dateFrom: '2026-10-01', dateTo: '2026-10-09' })
  })

  it('the actor box narrows the loaded rows without changing the hook params', () => {
    vi.useFakeTimers()
    render(<AuditLogSection />)
    expect(screen.getByText(/Filters the rows loaded/)).toBeInTheDocument()
    const before = audit.calls.length
    fireEvent.change(actorBox(), { target: { value: 'bayo' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText('Bayo Ade')).toBeInTheDocument()
    expect(screen.queryByText('Ada Obi')).not.toBeInTheDocument()
    expect(audit.calls.slice(before).every(c => JSON.stringify(c) === JSON.stringify(NONE))).toBe(true)
    // The next page is still available while the actor filter is on.
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('an actor with no loaded match shows the no-match state and Clear filters resets', () => {
    vi.useFakeTimers()
    render(<AuditLogSection />)
    fireEvent.change(actorBox(), { target: { value: 'zzz' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText(/No audit log entries match/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByRole('row')).toHaveLength(5)
    expect(actorBox()).toHaveValue('')
  })

  it('when capped it says so, and Next is disabled with no next page', () => {
    audit.result = ok({}, { capped: true, hasNext: false })
    render(<AuditLogSection />)
    expect(screen.getByText('Showing the newest 200 entries')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('does not show the capped note when not capped', () => {
    render(<AuditLogSection />)
    expect(screen.queryByText(/newest 200/)).not.toBeInTheDocument()
  })

  it('Export CSV exports the actor-filtered page rows as audit_log_page.csv', () => {
    vi.useFakeTimers()
    render(<AuditLogSection />)
    fireEvent.change(actorBox(), { target: { value: 'ada' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    expect(csv.exportCSV).toHaveBeenCalledTimes(1)
    const [rows, name] = csv.exportCSV.mock.calls[0]
    expect(name).toBe('audit_log_page.csv')
    // Flat records: no object values, so no cell can break the CSV columns.
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(Object.keys(r)).toEqual(['time', 'actor', 'action', 'target_type', 'target_id', 'details'])
      for (const v of Object.values(r)) expect(v === null || ['string', 'number'].includes(typeof v)).toBe(true)
    }
    expect(rows[0]).toEqual({
      time: logs[0].created_at, actor: 'Ada Obi', action: 'bulk_delete', target_type: 'post', target_id: 'p-1',
      details: JSON.stringify(logs[0].metadata),
    })
    expect(rows[1]).toMatchObject({ actor: 'Ada Obi', action: 'resolve', time: null, target_id: null, details: '' })
  })

  it('Export CSV is disabled when there are no rows', () => {
    audit.result = ok({}, { rows: [], hasNext: false })
    render(<AuditLogSection />)
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
  })
})
