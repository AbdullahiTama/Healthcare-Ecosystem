// The Money Checks tab: loading, error, empty, the findings list, and the three decisions a person can record. It must never
// act on money; it only calls the two admin actions that list findings and record a decision (and "run now").
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

const call = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth: call }))

import ReconciliationTab from './ReconciliationTab'

const finding = (over = {}) => ({
  id: 'f1', source: 'events', kind: 'unmatched_charge', subject_type: 'payment_reference', subject_id: 'ref_stranger_1', severity: 'critical',
  detail: 'Paystack reported a successful charge of 2500.00 NGN that no payment intent recognises', status: 'open', occurrences: 3,
  first_seen_at: '2026-10-05T08:00:00Z', last_seen_at: '2026-10-05T09:00:00Z', note: null, ...over,
})
const showToast = vi.fn()
const setup = () => render(<ReconciliationTab showToast={showToast} />)

beforeEach(() => { call.mockReset(); showToast.mockReset() })

describe('ReconciliationTab', () => {
  it('shows the open findings with their severity, subject and detail', async () => {
    call.mockResolvedValueOnce({ data: [finding(), finding({ id: 'f2', severity: 'warning', kind: 'stuck', subject_id: 'w1', detail: 'reserved since July' })] })
    setup()
    expect(await screen.findByText('unmatched charge')).toBeInTheDocument()
    expect(screen.getByText(/2500\.00 NGN/)).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 critical finding need a decision')
    expect(call).toHaveBeenCalledWith('admin_list_reconciliation', {})
  })

  it('says everything agrees when there is nothing open', async () => {
    call.mockResolvedValueOnce({ data: [] })
    setup()
    expect(await screen.findByText(/Nothing needs attention/)).toBeInTheDocument()
  })

  it('shows the error with a retry that asks again', async () => {
    call.mockRejectedValueOnce(new Error('Could not load findings')).mockResolvedValueOnce({ data: [] })
    setup()
    expect(await screen.findByText(/Could not load findings/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(await screen.findByText(/Nothing needs attention/)).toBeInTheDocument()
  })

  it('switching the status asks the server for that status', async () => {
    call.mockResolvedValue({ data: [] })
    setup()
    await screen.findByText(/Nothing needs attention/)
    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed' }))
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('admin_list_reconciliation', { status: 'dismissed' }))
    expect(await screen.findByText('No dismissed findings')).toBeInTheDocument()
  })

  it('acknowledges a finding', async () => {
    call.mockResolvedValueOnce({ data: [finding()] }).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ data: [finding({ status: 'acknowledged' })] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'acknowledge', note: undefined }))
    expect(showToast).toHaveBeenCalledWith('Finding acknowledged', { type: 'success' })
  })

  it('a dismissal needs a note of at least five characters, and sends it', async () => {
    call.mockResolvedValueOnce({ data: [finding()] }).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ data: [] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /Dismiss…/ }))
    const submit = screen.getByRole('button', { name: 'Dismiss finding' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Why is this explained/), { target: { value: 'no' } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Why is this explained/), { target: { value: 'no another integration' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(call).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'dismiss', note: 'no another integration' }))
    expect(showToast).toHaveBeenCalledWith('Finding dismissed', { type: 'success' })
  })

  it('cancelling a dismissal sends nothing', async () => {
    call.mockResolvedValueOnce({ data: [finding()] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /Dismiss…/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText(/Why is this explained/)).not.toBeInTheDocument()
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('a failed decision is reported and the list is left as it was', async () => {
    call.mockResolvedValueOnce({ data: [finding()] }).mockRejectedValueOnce(new Error('Finding not found'))
    setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't update the finding: Finding not found", { type: 'error' }))
    expect(screen.getByText('unmatched charge')).toBeInTheDocument()
  })

  it('reopens a dismissed finding', async () => {
    call.mockResolvedValueOnce({ data: [] })
    call.mockResolvedValueOnce({ data: [finding({ status: 'dismissed', note: 'known and explained' })] })
    call.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ data: [] })
    setup()
    await screen.findByText(/Nothing needs attention/)
    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed' }))
    expect(await screen.findByText(/known and explained/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'reopen', note: undefined }))
  })

  it('runs the checks on demand and reports the totals and any failed step', async () => {
    call.mockResolvedValueOnce({ data: [] })
    call.mockResolvedValueOnce({ report: { failed: ['provider'], db: { totals: { open_critical: 0, open_warning: 3, open_info: 9 } } } })
    call.mockResolvedValueOnce({ data: [] })
    setup()
    await screen.findByText(/Nothing needs attention/)
    fireEvent.click(screen.getByRole('button', { name: /Run checks now/ }))
    const status = await screen.findByText(/Checked\./)
    expect(status).toHaveTextContent('0 critical, 3 warning, 9 info open. Steps that failed: provider.')
    expect(within(status).queryByRole('button')).toBeNull()
  })
})
