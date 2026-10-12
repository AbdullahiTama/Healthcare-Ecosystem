import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({
  approveVerification: vi.fn(), rejectVerification: vi.fn(), openCredential: vi.fn(), busyId: null, credentialBusyId: null,
}))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn() }))
vi.mock('../hooks/useTrustQueues', () => ({ useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }))
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import VerificationsSection from './VerificationsSection.jsx'

const v = (over = {}) => ({ id: 'v1', status: 'pending', full_name: 'Amina Yusuf', profession: 'Pharmacist', workplace: 'Garki Pharmacy', phone: '0803', user_id: 'u1', credential_url: 'x', created_at: new Date().toISOString(), ...over })

beforeEach(() => {
  queues.value = { verifications: { status: 'ok', data: [v(), v({ id: 'v2', status: 'approved', full_name: 'Bola' })] }, claims: { status: 'ok', data: [] }, reports: { status: 'ok', data: [] } }
  actions.approveVerification.mockReset().mockResolvedValue({ ok: true })
  actions.rejectVerification.mockReset().mockResolvedValue({ ok: true })
  actions.openCredential.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  actions.busyId = null
  actions.credentialBusyId = null
})

describe('VerificationsSection', () => {
  it('lists pending requests by default', () => {
    render(<VerificationsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Verification' })).toBeInTheDocument()
    expect(screen.getByText('Amina Yusuf')).toBeInTheDocument()
    expect(screen.queryByText('Bola')).not.toBeInTheDocument()
  })

  it('approves from the drawer with the same payload and closes on success', async () => {
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(actions.approveVerification).toHaveBeenCalledWith({ id: 'v1', userId: 'u1', profession: 'Pharmacist' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks for confirmation before rejecting, and does not reject until confirmed', () => {
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reject' }))
    expect(actions.rejectVerification).not.toHaveBeenCalled()
    admin.askConfirm.mock.calls[0][0].action()
    expect(actions.rejectVerification).toHaveBeenCalledWith('v1')
  })

  it('keeps the drawer open and shows the error when approve fails', async () => {
    actions.approveVerification.mockResolvedValue({ ok: false, error: 'Not allowed' })
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows a credential error from openCredential in the drawer', async () => {
    actions.openCredential.mockResolvedValue({ ok: false, error: 'Your browser blocked the document window.' })
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'View credential' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked/i)
  })

  it('has no Approve or Reject for an already decided request', () => {
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Bola' }))
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows Retry when the list failed to load', () => {
    queues.value = { ...queues.value, verifications: { status: 'error' } }
    render(<VerificationsSection />)
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('offers a Review button named after the applicant on pending rows', () => {
    render(<VerificationsSection />)
    expect(screen.getByRole('button', { name: 'Review Amina Yusuf' })).toBeInTheDocument()
  })

  it('opening the credential shows its own spinner and leaves Approve usable', () => {
    actions.credentialBusyId = 'v1'
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    expect(screen.getByRole('button', { name: 'Opening…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('an approval in flight leaves View credential usable', () => {
    actions.busyId = 'v1'
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    expect(screen.getByRole('button', { name: 'View credential' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })
})
