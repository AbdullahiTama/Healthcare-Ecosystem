import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({
  approveVerification: vi.fn(), rejectVerification: vi.fn(), resolveReport: vi.fn(), deletePost: vi.fn(), openCredential: vi.fn(), busyId: null,
}))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn(), invalidateAdmin: vi.fn() }))
const adminData = vi.hoisted(() => ({ value: { posts: [] } }))
const api = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../hooks/useTrustQueues', async () => {
  const actual = await vi.importActual('../hooks/useTrustQueues')
  return { ...actual, useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }
})
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))
vi.mock('../../../hooks/queries', () => ({ useAdminData: () => ({ data: adminData.value }) }))
vi.mock('../adminApi', () => ({ callAdminAuth: api.callAdminAuth }))

import ModerationSection from './ModerationSection.jsx'
import { ModerationProvider } from '../stores/moderationStore'

const now = new Date().toISOString()
const report = (over = {}) => ({ id: 'r1', post_id: 'p1', status: 'pending', reason: 'spam', posts: { content: 'Buy cheap pills now' }, created_at: now, ...over })
const verification = (over = {}) => ({ id: 'v1', status: 'pending', full_name: 'Amina Yusuf', profession: 'Pharmacist', workplace: 'Garki Pharmacy', phone: '0803', user_id: 'u1', created_at: now, ...over })
const flagged = { id: 'p9', status: 'flagged', content: 'Miracle cure inside', report_count: 0, created_at: now }

const REPORT = 'spam'
const VERIFICATION = 'Verification: Amina Yusuf'
const POST = 'Miracle cure inside'

const renderSection = () => render(<ModerationProvider><ModerationSection /></ModerationProvider>)
const select = (title) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${title}` }))
const calls = (name) => api.callAdminAuth.mock.calls.filter(([action]) => action === name)
const runConfirmed = async () => { await act(async () => { await admin.askConfirm.mock.calls[0][0].action() }) }

beforeEach(() => {
  queues.value = {
    verifications: { status: 'ok', data: [verification(), verification({ id: 'v2', status: 'approved', full_name: 'Bola' })] },
    claims: { status: 'ok', data: [] },
    reports: { status: 'ok', data: [report(), report({ id: 'r2', reason: 'scam' }), report({ id: 'r3', post_id: 'p2', status: 'resolved', reason: 'abuse', posts: { content: 'Old post' } })] },
  }
  queues.refetch.mockReset()
  adminData.value = { posts: [flagged] }
  api.callAdminAuth.mockReset().mockResolvedValue({})
  actions.approveVerification.mockReset().mockResolvedValue({ ok: true })
  actions.rejectVerification.mockReset().mockResolvedValue({ ok: true })
  actions.resolveReport.mockReset().mockResolvedValue({ ok: true })
  actions.deletePost.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
  admin.invalidateAdmin.mockReset()
})

describe('ModerationSection', () => {
  it('lists a report, a flagged post and a pending verification, each with a priority', () => {
    renderSection()
    expect(screen.getByRole('heading', { level: 1, name: 'Moderation' })).toBeInTheDocument()
    for (const title of [REPORT, POST, VERIFICATION]) {
      const row = screen.getByRole('checkbox', { name: `Select ${title}` }).closest('tr')
      expect(within(row).getByText(title)).toBeInTheDocument()
      expect(within(row).getByText(/^(Urgent|High|Medium|Low)$/)).toBeInTheDocument()
    }
    // Two pending reports on one post collapse into one item and raise its priority.
    expect(within(screen.getByRole('checkbox', { name: `Select ${REPORT}` }).closest('tr')).getByText('High')).toBeInTheDocument()
  })

  it('lists only what is waiting: no resolved report, no decided verification', () => {
    renderSection()
    expect(screen.queryByRole('checkbox', { name: 'Select abuse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Verification: Bola' })).not.toBeInTheDocument()
  })

  it('narrows the list by source and by priority', () => {
    renderSection()
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'verification' } })
    expect(screen.getByRole('checkbox', { name: `Select ${VERIFICATION}` })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: `Select ${REPORT}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: `Select ${POST}` })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })
    expect(screen.getByRole('checkbox', { name: `Select ${REPORT}` })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: `Select ${VERIFICATION}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: `Select ${POST}` })).not.toBeInTheDocument()
  })

  it('says there is nothing to match when a filter empties the list, not that nothing is waiting', () => {
    renderSection()
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } })
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument()
  })

  it('says Nothing waiting when both lists loaded and nothing is pending', () => {
    queues.value = { ...queues.value, verifications: { status: 'ok', data: [] }, reports: { status: 'ok', data: [] } }
    adminData.value = { posts: [] }
    renderSection()
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument()
  })

  it('Approve verifications on a mixed selection approves only the verification and names the skipped report', async () => {
    renderSection()
    select(VERIFICATION)
    select(REPORT)
    fireEvent.click(screen.getByRole('button', { name: 'Approve verifications' }))
    await waitFor(() => expect(admin.showToast).toHaveBeenCalled())
    expect(calls('approve_verification')).toEqual([['approve_verification', { id: 'v1', userId: 'u1', profession: 'Pharmacist' }]])
    expect(calls('resolve_report')).toEqual([])
    expect(admin.showToast).toHaveBeenCalledWith('Approved 1. Skipped: spam (not a verification)', { type: 'warning' })
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: `Select ${VERIFICATION}` })).not.toBeChecked()
    // Auth travels in the header; no payload ever carries a token.
    for (const [, payload] of api.callAdminAuth.mock.calls) expect(payload).not.toHaveProperty('token')
  })

  it('Reject verifications on a report row never calls resolve_report and names the skipped report', async () => {
    renderSection()
    select(REPORT)
    fireEvent.click(screen.getByRole('button', { name: 'Reject verifications' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reject verifications' }))
    expect(api.callAdminAuth).not.toHaveBeenCalled()
    await runConfirmed()
    expect(calls('resolve_report')).toEqual([])
    expect(calls('reject_verification')).toEqual([])
    expect(admin.showToast).toHaveBeenCalledWith('Rejected 0. Skipped: spam (not a verification)', { type: 'warning' })
  })

  it('Reject verifications rejects by request id after confirmation', async () => {
    renderSection()
    select(VERIFICATION)
    fireEvent.click(screen.getByRole('button', { name: 'Reject verifications' }))
    expect(calls('reject_verification')).toEqual([])
    await runConfirmed()
    expect(calls('reject_verification')).toEqual([['reject_verification', { id: 'v1' }]])
    expect(admin.showToast).toHaveBeenCalledWith('Rejected 1', { type: 'success' })
  })

  it('Dismiss reports resolves every pending report on the post by REPORT id, never the post id', async () => {
    renderSection()
    select(REPORT)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reports' }))
    await waitFor(() => expect(admin.showToast).toHaveBeenCalled())
    expect(calls('resolve_report')).toEqual([['resolve_report', { id: 'r1' }], ['resolve_report', { id: 'r2' }]])
    expect(api.callAdminAuth).not.toHaveBeenCalledWith('resolve_report', { id: 'p1' })
    expect(admin.showToast).toHaveBeenCalledWith('Dismissed 1', { type: 'success' })
  })

  it('Delete posts asks for confirmation first, then deletes by post id', async () => {
    renderSection()
    select(POST)
    select(REPORT)
    select(VERIFICATION)
    fireEvent.click(screen.getByRole('button', { name: 'Delete posts' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Delete posts' }))
    expect(calls('delete_post')).toEqual([])
    await runConfirmed()
    expect(calls('delete_post').map(([, p]) => p).sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: 'p1' }, { id: 'p9' }])
    expect(admin.showToast).toHaveBeenCalledWith('Deleted 2. Skipped: Verification: Amina Yusuf (not a post)', { type: 'warning' })
  })

  it('Delete posts skips a report whose post is gone and names it', async () => {
    queues.value = { ...queues.value, reports: { status: 'ok', data: [report({ id: 'r9', post_id: null, reason: 'abuse', posts: null })] } }
    adminData.value = { posts: [] }
    renderSection()
    select('abuse')
    fireEvent.click(screen.getByRole('button', { name: 'Delete posts' }))
    await runConfirmed()
    expect(calls('delete_post')).toEqual([])
    expect(admin.showToast).toHaveBeenCalledWith('Deleted 0. Skipped: abuse (no post to delete)', { type: 'warning' })
  })

  it('names a failed item in an error toast', async () => {
    api.callAdminAuth.mockImplementation(async (action) => { if (action === 'approve_verification') throw new Error('Not allowed'); return {} })
    renderSection()
    select(VERIFICATION)
    fireEvent.click(screen.getByRole('button', { name: 'Approve verifications' }))
    await waitFor(() => expect(admin.showToast).toHaveBeenCalledWith('Approved 0. Failed: Verification: Amina Yusuf (Not allowed)', { type: 'error' }))
  })

  it('row checkboxes are labelled inputs, and Select all selects only the filtered rows', () => {
    renderSection()
    const boxes = screen.getAllByRole('checkbox', { name: /^Select .+/ })
    for (const box of boxes) {
      expect(box.tagName).toBe('INPUT')
      expect(box).toHaveAttribute('type', 'checkbox')
    }
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'report' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByRole('checkbox', { name: `Select ${REPORT}` })).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'all' } })
    expect(screen.getByRole('checkbox', { name: `Select ${VERIFICATION}` })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: `Select ${POST}` })).not.toBeChecked()
  })

  it('Review on a report shows the Reports drawer body, and Dismiss resolves every pending report by id', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: `Review ${REPORT}` }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Reason')).toBeInTheDocument()
    expect(within(dialog).getByText('Buy cheap pills now', { selector: '.adm-drawer-text' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(actions.resolveReport.mock.calls).toEqual([['r1'], ['r2']])
  })

  it('a report drawer deletes the post only after confirmation, by post id', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: `Review ${REPORT}` }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete post' }))
    expect(actions.deletePost).not.toHaveBeenCalled()
    await runConfirmed()
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
  })

  it('a failed dismiss keeps the drawer open with the error', async () => {
    actions.resolveReport.mockResolvedValueOnce({ ok: false, error: 'Not allowed' })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: `Review ${REPORT}` }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Not allowed')
    expect(actions.resolveReport).toHaveBeenCalledTimes(1)
  })

  it('Review on a verification shows the applicant details and approves with the same payload', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: `Review ${VERIFICATION}` }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Applicant')).toBeInTheDocument()
    expect(within(dialog).getByText('Garki Pharmacy')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(actions.approveVerification).toHaveBeenCalledWith({ id: 'v1', userId: 'u1', profession: 'Pharmacist' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a verification drawer rejects only after confirmation', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: `Review ${VERIFICATION}` }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject' }))
    expect(actions.rejectVerification).not.toHaveBeenCalled()
    await runConfirmed()
    expect(actions.rejectVerification).toHaveBeenCalledWith('v1')
  })

  it('Review on a flagged post shows its text and deletes it after confirmation', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: `Review ${POST}` }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(POST, { selector: '.adm-drawer-text' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete post' }))
    expect(actions.deletePost).not.toHaveBeenCalled()
    await runConfirmed()
    expect(actions.deletePost).toHaveBeenCalledWith('p9')
  })

  it('a failed reports list shows a Retry banner and still lists the verification, never Nothing waiting', () => {
    queues.value = { ...queues.value, reports: { status: 'error' } }
    adminData.value = { posts: [] }
    renderSection()
    expect(screen.getByText("Couldn't load reports")).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Select ${VERIFICATION}` })).toBeInTheDocument()
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(queues.refetch).toHaveBeenCalled()
  })

  it('a failed verifications list with nothing else waiting is never shown as Nothing waiting', () => {
    queues.value = { ...queues.value, verifications: { status: 'error' }, reports: { status: 'ok', data: [] } }
    adminData.value = { posts: [] }
    renderSection()
    expect(screen.getByText("Couldn't load verifications")).toBeInTheDocument()
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows loading rather than an empty queue while the lists load', () => {
    queues.value = undefined
    renderSection()
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /^Select / })).not.toBeInTheDocument()
  })
})
