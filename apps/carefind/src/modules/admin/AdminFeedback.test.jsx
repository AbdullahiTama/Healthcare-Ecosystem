import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('./adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from './test/renderAdmin.jsx'
import { useAdminToast, useAdminConfirm, useAdminActivity, useAuditLog } from './AdminFeedback.jsx'

function Probe({ action }) {
  const toast = useAdminToast()
  const confirm = useAdminConfirm()
  const { recentActions, recordAction } = useAdminActivity()
  const audit = useAuditLog()
  return (
    <div>
      <button onClick={() => toast('Saved it', { type: 'success' })}>toast</button>
      <button onClick={() => confirm({ title: 'Delete this post?', consequence: 'It cannot be undone.', action })}>ask</button>
      <button onClick={() => recordAction({ action: 'approve', target: 'report', id: 'r1' })}>record</button>
      <button onClick={() => audit('approve', 'report', 'r1', { a: 1 })}>audit</button>
      <span>actions:{recentActions.length}</span>
    </div>
  )
}

describe('AdminFeedbackProvider', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows a toast', async () => {
    renderAdmin(<Probe />)
    fireEvent.click(screen.getByText('toast'))
    expect(await screen.findByText('Saved it')).toBeInTheDocument()
  })

  it('runs the action only after the admin confirms, and states the consequence', async () => {
    const action = vi.fn()
    renderAdmin(<Probe action={action} />)
    fireEvent.click(screen.getByText('ask'))
    expect(await screen.findByText('Delete this post?')).toBeInTheDocument()
    expect(screen.getByText('It cannot be undone.')).toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not run the action when the admin cancels', async () => {
    const action = vi.fn()
    renderAdmin(<Probe action={action} />)
    fireEvent.click(screen.getByText('ask'))
    // Exact name: the shared Modal's card also carries role="button", and its
    // accessible name contains every label inside the dialog.
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Delete this post?')).not.toBeInTheDocument())
    expect(action).not.toHaveBeenCalled()
  })

  it('records recent actions with a timestamp', () => {
    renderAdmin(<Probe />)
    fireEvent.click(screen.getByText('record'))
    expect(screen.getByText('actions:1')).toBeInTheDocument()
  })

  it('writes an audit entry and never throws when the audit call fails', async () => {
    callAdminAuth.mockRejectedValue(new Error('audit down'))
    renderAdmin(<Probe />)
    fireEvent.click(screen.getByText('audit'))
    await waitFor(() => expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', {
      auditAction: 'approve', targetType: 'report', targetId: 'r1', metadata: { a: 1 },
    }))
  })
})
