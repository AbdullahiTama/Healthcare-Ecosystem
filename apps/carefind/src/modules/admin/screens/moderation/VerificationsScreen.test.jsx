import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import VerificationsScreen from './VerificationsScreen.jsx'

const now = Date.now()
const rows = [
  { id: 'v1', user_id: 'u1', full_name: 'Amina Bello', profession: 'Pharmacist', workplace: 'MedPlus', phone: '0801', status: 'pending', credential_url: 'creds/v1.pdf', created_at: new Date(now - 2 * 86400000).toISOString() },
  { id: 'v2', user_id: 'u2', full_name: 'Tunde Afolabi', profession: 'Doctor', workplace: null, phone: null, status: 'pending', credential_url: null, created_at: new Date(now - 3600000).toISOString() },
  { id: 'v3', user_id: 'u3', full_name: 'Ngozi Eze', profession: 'Nurse', status: 'approved', created_at: new Date(now - 9 * 86400000).toISOString() },
  { id: 'v4', user_id: 'u4', full_name: null, profession: null, status: 'pending', created_at: null },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_verification_requests') return { data: rows }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
const at = (route) => renderAdmin(<VerificationsScreen />, { route })

describe('VerificationsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi() })

  it('lists pending requests by default and shows the counts', async () => {
    at('/admin/moderation/verifications')
    expect(await screen.findByRole('button', { name: 'Open Amina Bello' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Tunde Afolabi' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Ngozi Eze' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Verifications' })).toBeInTheDocument()
    expect(screen.getByText('3 pending · 4 total')).toBeInTheDocument()
  })

  it('renders a row with no name, profession or date without failing', async () => {
    at('/admin/moderation/verifications')
    expect(await screen.findByRole('button', { name: 'Open Unnamed applicant' })).toBeInTheDocument()
  })

  it('filters by status from the URL and by search text', async () => {
    at('/admin/moderation/verifications?status=approved')
    expect(await screen.findByRole('button', { name: 'Open Ngozi Eze' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Amina Bello' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'doctor' } })
    expect(await screen.findByRole('button', { name: 'Open Tunde Afolabi' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Ngozi Eze' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    at('/admin/moderation/verifications?q=zzzz')
    expect(await screen.findByText('No verification requests match these filters')).toBeInTheDocument()
  })

  it('shows an error with retry when the list fails, not an empty list', async () => {
    let fail = true
    mockApi({ list_verification_requests: async () => { if (fail) throw new Error('down'); return { data: rows } } })
    at('/admin/moderation/verifications')
    const retry = await screen.findByRole('button', { name: /try again|retry/i })
    expect(screen.queryByText('No verification requests match these filters')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: 'Open Amina Bello' })).toBeInTheDocument()
  })

  it('opens a record in the drawer from the list and from a link', async () => {
    at('/admin/moderation/verifications?id=v2')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Tunde Afolabi')).toBeInTheDocument()
    expect(within(dialog).getByText('Doctor')).toBeInTheDocument()
  })

  it('says the record could not be found when a linked id is not in the list', async () => {
    at('/admin/moderation/verifications?id=gone')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('This request could not be found. It may already have been handled.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('approves once even on a double click, logs it, and closes the drawer', async () => {
    let release
    mockApi({ approve_verification: () => new Promise(r => { release = () => r({}) }) })
    at('/admin/moderation/verifications?id=v1')
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    await waitFor(() => expect(calls('approve_verification')).toHaveLength(1))
    expect(calls('approve_verification')[0][1]).toEqual({ id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    release()
    expect(await screen.findByText('Verification approved')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('log_audit_action')[0][1]).toMatchObject({ auditAction: 'approve', targetType: 'verification', targetId: 'v1' })
  })

  it('rejects a request', async () => {
    at('/admin/moderation/verifications?id=v2')
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(calls('reject_verification')[0][1]).toEqual({ id: 'v2' }))
    expect(await screen.findByText('Verification rejected')).toBeInTheDocument()
  })

  it('keeps the drawer open and explains when an action fails', async () => {
    mockApi({ approve_verification: async () => { throw new Error('server said no') } })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText("Couldn't approve the verification: server said no")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers no actions on a request that is already decided', async () => {
    at('/admin/moderation/verifications?status=approved&id=v3')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Approved')).toBeInTheDocument()
  })

  it('opens the credential in a tab opened during the click', async () => {
    const tab = { location: '', close: vi.fn(), opener: window }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    mockApi({ credential_url: async () => ({ url: 'https://signed.example/doc' }) })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: 'View credential' }))
    // Opened without the noopener feature (which makes window.open return
    // null, so the tab could never be pointed at the document); the opener
    // link is cut by hand instead.
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    await waitFor(() => expect(tab.location).toBe('https://signed.example/doc'))
    expect(calls('credential_url')[0][1]).toEqual({ requestId: 'v1' })
    open.mockRestore()
  })

  it('explains when the browser blocks the credential window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mockApi({ credential_url: async () => ({ url: 'https://signed.example/doc' }) })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: 'View credential' }))
    expect(await screen.findByText(/blocked the document window/)).toBeInTheDocument()
    open.mockRestore()
  })

  it('does not close a different record that was opened while an action was still running', async () => {
    let release
    mockApi({ approve_verification: () => new Promise(r => { release = () => r({}) }) })
    at('/admin/moderation/verifications?id=v1')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls('approve_verification')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Open Tunde Afolabi' }))
    expect(within(await screen.findByRole('dialog')).getByText('Doctor')).toBeInTheDocument()
    release()
    expect(await screen.findByText('Verification approved')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('Doctor')).toBeInTheDocument()
  })
})
