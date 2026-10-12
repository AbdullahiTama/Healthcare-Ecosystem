// The Money Checks screen: loading, error, empty, the findings table, the drawer
// and the three decisions a person can record. It must never act on money; it
// only calls the admin actions that list findings, record a decision and run the
// checks now. Ported from tabs/ReconciliationTab.test.jsx (each legacy case is
// marked "legacy:"), adapted to the drawer flow. The real hooks run over a
// mocked adminApi, so the payloads asserted are the ones the server receives.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const call = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())
const invalidateAdmin = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth: call }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => ({ showToast, invalidateAdmin, confirming: false }) }))

import MoneyChecksSection from './MoneyChecksSection.jsx'

const ALLOWED = ['admin_list_reconciliation', 'admin_update_reconciliation_finding', 'admin_run_reconciliation']
// Every action name called anywhere in this file; checked by the last test.
const seen = new Set()

const finding = (over = {}) => ({
  id: 'f1', source: 'events', kind: 'unmatched_charge', subject_type: 'payment_reference', subject_id: 'ref_stranger_1', severity: 'critical',
  detail: 'Paystack reported a successful charge of 2500.00 NGN that no payment intent recognises', status: 'open', occurrences: 3,
  first_seen_at: '2026-10-05T08:00:00Z', last_seen_at: '2026-10-05T09:00:00Z', note: null, ...over,
})

// One QueryClient per test, created here and not inside the wrapper body.
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

let client
const setup = () => {
  const made = makeWrapper()
  client = made.client
  return render(<MoneyChecksSection />, { wrapper: made.wrapper })
}

// The responses, in order; once used up, a list call returns an empty list.
const respond = (...responses) => {
  call.mockImplementation((action, payload) => {
    seen.add(action)
    const next = responses.shift()
    if (typeof next === 'function') return next(action, payload)
    if (next instanceof Error) return Promise.reject(next)
    if (next !== undefined) return Promise.resolve(next)
    return Promise.resolve(action === 'admin_list_reconciliation' ? { data: [] } : {})
  })
}

const dialog = () => within(screen.getByRole('dialog'))
const review = async (kind = 'unmatched charge') => fireEvent.click(await screen.findByRole('button', { name: `Review ${kind}` }))
const listCalls = () => call.mock.calls.filter(([a]) => a === 'admin_list_reconciliation')
const updateCalls = () => call.mock.calls.filter(([a]) => a === 'admin_update_reconciliation_finding')

beforeEach(() => {
  call.mockReset()
  respond()
  showToast.mockReset()
  invalidateAdmin.mockReset()
})

describe('MoneyChecksSection', () => {
  it('has the title, the subtitle and the four status tabs, Open selected', async () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Money Checks' })).toBeInTheDocument()
    expect(screen.getByText('Differences found between our books, the payment engines and Paystack')).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Finding status' })).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Open', 'Acknowledged', 'Resolved', 'Dismissed'])
    expect(screen.getByRole('tab', { name: 'Open' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByText('Nothing needs attention. Every check agrees.')
  })

  // legacy: shows the open findings with their severity, subject and detail
  it('shows the open findings with their severity and subject, the detail in the drawer, and the critical alert', async () => {
    respond({ data: [finding(), finding({ id: 'f2', severity: 'warning', kind: 'stuck', subject_id: 'w1', detail: 'reserved since July' })] })
    setup()
    expect(await screen.findByText('unmatched charge')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getByText(/ref_stranger_1/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 critical finding need a decision.')
    expect(call).toHaveBeenCalledWith('admin_list_reconciliation', {})
    await review()
    expect(dialog().getByText(/2500\.00 NGN/)).toBeInTheDocument()
    expect(dialog().getByText('payment_reference')).toBeInTheDocument()
    expect(dialog().getByText('ref_stranger_1')).toBeInTheDocument()
    expect(dialog().getByText(/seen 3×/)).toBeInTheDocument()
  })

  it('opens the drawer from a row click too', async () => {
    respond({ data: [finding()] })
    setup()
    fireEvent.click(await screen.findByText('unmatched charge'))
    expect(screen.getByRole('dialog')).toHaveTextContent('unmatched charge')
  })

  it('shows the note in the drawer when the finding has one', async () => {
    respond({ data: [finding({ status: 'acknowledged', note: 'looking into it' })] })
    setup()
    await review()
    expect(dialog().getByText('looking into it')).toBeInTheDocument()
  })

  it('counts acknowledged critical findings and says findings for more than one', async () => {
    respond({ data: [finding(), finding({ id: 'f2', status: 'acknowledged', kind: 'stuck' }), finding({ id: 'f3', severity: 'info', kind: 'late' })] })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('2 critical findings need a decision.')
  })

  it('shows no critical alert outside the Open tab', async () => {
    respond({ data: [] }, { data: [finding({ status: 'resolved' })] })
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    fireEvent.click(screen.getByRole('tab', { name: 'Resolved' }))
    expect(await screen.findByText('unmatched charge')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // legacy: says everything agrees when there is nothing open
  it('says everything agrees when there is nothing open', async () => {
    respond({ data: [] })
    setup()
    expect(await screen.findByText('Nothing needs attention. Every check agrees.')).toBeInTheDocument()
  })

  it('shows neither Retry nor the empty message while loading', () => {
    respond(() => new Promise(() => {}))
    setup()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Every check agrees/)).not.toBeInTheDocument()
  })

  // legacy: shows the error with a retry that asks again
  it('shows the error with a retry that asks again', async () => {
    respond(new Error('Could not load findings'), { data: [] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Nothing needs attention. Every check agrees.')).toBeInTheDocument()
    expect(listCalls()).toHaveLength(2)
  })

  it('a failed list shows Retry and never says every check agrees', async () => {
    respond(new Error('down'))
    setup()
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByText(/Couldn't load/)).toBeInTheDocument()
    expect(screen.queryByText(/Every check agrees/)).not.toBeInTheDocument()
  })

  it('a list response without a list is a failure, not "every check agrees"', async () => {
    respond({})
    setup()
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText(/Every check agrees/)).not.toBeInTheDocument()
  })

  // legacy: switching the status asks the server for that status
  it('switching the status asks the server for that status', async () => {
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed' }))
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('admin_list_reconciliation', { status: 'dismissed' }))
    expect(await screen.findByText('No dismissed findings')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dismissed' })).toHaveAttribute('aria-selected', 'true')
  })

  it('the Open tab sends no filter and the Resolved tab sends { status: "resolved" }', async () => {
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    expect(listCalls()[0]).toEqual(['admin_list_reconciliation', {}])
    fireEvent.click(screen.getByRole('tab', { name: 'Resolved' }))
    expect(await screen.findByText('No resolved findings')).toBeInTheDocument()
    expect(listCalls()[1]).toEqual(['admin_list_reconciliation', { status: 'resolved' }])
    fireEvent.click(screen.getByRole('tab', { name: 'Acknowledged' }))
    expect(await screen.findByText('No acknowledged findings')).toBeInTheDocument()
    expect(listCalls()[2]).toEqual(['admin_list_reconciliation', { status: 'acknowledged' }])
  })

  it('Refresh asks the server again', async () => {
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh findings' }))
    await waitFor(() => expect(listCalls()).toHaveLength(2))
  })

  it('offers the decisions for each status exactly as before', async () => {
    const offered = async (status) => {
      call.mockReset()
      respond({ data: [finding({ status })] })
      const view = setup()
      await review()
      const names = ['Acknowledge', 'Dismiss…', 'Reopen'].filter(n => dialog().queryByRole('button', { name: n }))
      view.unmount()
      return names
    }
    expect(await offered('open')).toEqual(['Acknowledge', 'Dismiss…'])
    expect(await offered('acknowledged')).toEqual(['Dismiss…', 'Reopen'])
    expect(await offered('resolved')).toEqual(['Reopen'])
    expect(await offered('dismissed')).toEqual(['Reopen'])
  })

  // legacy: acknowledges a finding
  it('acknowledges a finding and closes the drawer', async () => {
    respond({ data: [finding()] }, { success: true })
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'acknowledge', note: undefined }))
    expect(showToast).toHaveBeenCalledWith('Finding acknowledged', { type: 'success' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('disables the finding buttons while its decision is being saved', async () => {
    let release
    respond({ data: [finding()] }, () => new Promise(r => { release = r }))
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Acknowledge' }))
    expect(dialog().getByRole('button', { name: 'Acknowledge' })).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Dismiss…' })).toBeDisabled()
    await act(async () => { release({ success: true }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // legacy: a dismissal needs a note of at least five characters, and sends it
  it('a dismissal needs a note of at least five characters, and sends it trimmed', async () => {
    respond({ data: [finding()] }, { success: true })
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Dismiss…' }))
    const submit = dialog().getByRole('button', { name: 'Dismiss finding' })
    const box = dialog().getByLabelText('Why is this explained? (kept on the record)')
    expect(box).toHaveAttribute('maxLength', '500')
    expect(submit).toBeDisabled()
    fireEvent.change(box, { target: { value: 'no' } })
    expect(submit).toBeDisabled()
    fireEvent.change(box, { target: { value: '  no another integration  ' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(call).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'dismiss', note: 'no another integration' }))
    expect(showToast).toHaveBeenCalledWith('Finding dismissed', { type: 'success' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Dismiss stays disabled for a 4-character note and enables at 5 trimmed characters; spaces do not count', async () => {
    respond({ data: [finding()] })
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Dismiss…' }))
    const submit = dialog().getByRole('button', { name: 'Dismiss finding' })
    const box = dialog().getByLabelText('Why is this explained? (kept on the record)')
    fireEvent.change(box, { target: { value: 'abcd' } })
    expect(submit).toBeDisabled()
    fireEvent.change(box, { target: { value: '     abcd     ' } })
    expect(submit).toBeDisabled()
    fireEvent.submit(box.closest('form'))
    expect(updateCalls()).toHaveLength(0)
    fireEvent.change(box, { target: { value: ' abcde ' } })
    expect(submit).toBeEnabled()
  })

  // legacy: cancelling a dismissal sends nothing
  it('cancelling a dismissal sends nothing', async () => {
    respond({ data: [finding()] })
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Dismiss…' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText(/Why is this explained/)).not.toBeInTheDocument()
    expect(call).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // legacy: a failed decision is reported and the list is left as it was
  it('a failed decision keeps the drawer open with the error, and the list is left as it was', async () => {
    respond({ data: [finding()] }, new Error('Finding not found'))
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Acknowledge' }))
    expect(await dialog().findByRole('alert')).toHaveTextContent("Couldn't update the finding: Finding not found")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(showToast).not.toHaveBeenCalledWith('Finding acknowledged', { type: 'success' })
    expect(dialog().getByRole('button', { name: 'Acknowledge' })).toBeEnabled()
    expect(showToast).not.toHaveBeenCalled()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    expect(screen.getByText('unmatched charge')).toBeInTheDocument()
  })

  it('a failed dismissal keeps the note and the drawer open', async () => {
    respond({ data: [finding()] }, new Error('Not allowed'))
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Dismiss…' }))
    fireEvent.change(dialog().getByLabelText(/Why is this explained/), { target: { value: 'explained by refund' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Dismiss finding' }))
    expect(await dialog().findByRole('alert')).toHaveTextContent("Couldn't update the finding: Not allowed")
    expect(dialog().getByLabelText(/Why is this explained/)).toHaveValue('explained by refund')
  })

  // legacy: reopens a dismissed finding
  it('reopens a dismissed finding', async () => {
    respond({ data: [] }, { data: [finding({ status: 'dismissed', note: 'known and explained' })] }, { success: true })
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed' }))
    await review()
    expect(dialog().getByText(/known and explained/)).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'reopen', note: undefined }))
    expect(showToast).toHaveBeenCalledWith('Finding reopened', { type: 'success' })
  })

  it('the drawer survives a list refresh, showing the fresh row, and keeps the snapshot when the row leaves the list', async () => {
    respond({ data: [finding()] }, { data: [finding({ status: 'acknowledged', occurrences: 4 })] }, { data: [] })
    setup()
    await review()
    expect(dialog().getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument()
    await act(async () => { await client.invalidateQueries() })
    await waitFor(() => expect(dialog().getByText(/seen 4×/)).toBeInTheDocument())
    expect(dialog().queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument()
    expect(dialog().getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    await act(async () => { await client.invalidateQueries() })
    await waitFor(() => expect(listCalls()).toHaveLength(3))
    expect(screen.getByRole('dialog')).toHaveTextContent('unmatched charge')
    expect(dialog().getByText(/seen 4×/)).toBeInTheDocument()
  })

  it('a late result for one finding does not land on the drawer of another', async () => {
    let release
    respond({ data: [finding(), finding({ id: 'f2', kind: 'stuck', severity: 'warning' })] }, () => new Promise(r => { release = r }))
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Acknowledge' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    await review('stuck')
    await act(async () => { release(Promise.reject(new Error('Finding not found'))) })
    expect(screen.getByRole('dialog')).toHaveTextContent('stuck')
    expect(dialog().queryByRole('alert')).not.toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith("Couldn't update the finding: Finding not found", { type: 'error' })
  })

  it('toasts a failed decision that arrives after the drawer was closed', async () => {
    let release
    respond({ data: [finding()] }, () => new Promise(r => { release = r }))
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Acknowledge' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { release(Promise.reject(new Error('Finding not found'))) })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't update the finding: Finding not found", { type: 'error' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not toast again for a late successful decision (the hook already did)', async () => {
    let release
    respond({ data: [finding()] }, () => new Promise(r => { release = r }))
    setup()
    await review()
    fireEvent.click(dialog().getByRole('button', { name: 'Acknowledge' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    await act(async () => { release({ success: true }) })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Finding acknowledged', { type: 'success' }))
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  // legacy: runs the checks on demand and reports the totals and any failed step
  it('runs the checks on demand and reports the totals and any failed step', async () => {
    let release
    respond({ data: [] }, () => new Promise(r => { release = r }))
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    fireEvent.click(screen.getByRole('button', { name: 'Run checks now' }))
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()
    await act(async () => { release({ report: { failed: ['provider'], db: { totals: { open_critical: 0, open_warning: 3, open_info: 9 } } } }) })
    const status = await screen.findByText(/Checked\./)
    expect(status).toHaveTextContent('0 critical, 3 warning, 9 info open. Steps that failed: provider.')
    expect(status.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
    expect(within(status).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run checks now' })).toBeEnabled()
    expect(call).toHaveBeenCalledWith('admin_run_reconciliation')
  })

  it('a run that fails shows no summary (the hook toasts the failure)', async () => {
    respond({ data: [] }, new Error('timeout'))
    setup()
    await screen.findByText('Nothing needs attention. Every check agrees.')
    fireEvent.click(screen.getByRole('button', { name: 'Run checks now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('The check could not run: timeout', { type: 'error' }))
    expect(screen.queryByText(/Checked\.|Run finished/)).not.toBeInTheDocument()
  })

  // legacy (file header): it must never act on money
  it('across this whole file, only ever called the three money-check actions', () => {
    expect(seen.size).toBeGreaterThan(0)
    for (const a of seen) expect(ALLOWED).toContain(a)
  })
})
