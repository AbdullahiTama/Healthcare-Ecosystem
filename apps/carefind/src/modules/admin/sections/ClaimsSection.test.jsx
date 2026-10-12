import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({ approveClaim: vi.fn(), rejectClaim: vi.fn(), busyId: null }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn() }))
vi.mock('../hooks/useTrustQueues', () => ({ useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }))
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import ClaimsSection from './ClaimsSection.jsx'

const claim = (over = {}) => ({ id: 'c1', business_id: 'b1', status: 'pending', businesses: { name: 'Garki Pharmacy' }, created_at: new Date().toISOString(), ...over })

beforeEach(() => {
  queues.value = {
    verifications: { status: 'ok', data: [] }, reports: { status: 'ok', data: [] },
    claims: { status: 'ok', data: [claim(), claim({ id: 'c2', status: 'approved', businesses: { name: 'Wuse Clinic' } })] },
  }
  actions.approveClaim.mockReset().mockResolvedValue({ ok: true })
  actions.rejectClaim.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
})

describe('ClaimsSection', () => {
  it('lists pending claims by default', () => {
    render(<ClaimsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Claims' })).toBeInTheDocument()
    expect(screen.getByText('Garki Pharmacy')).toBeInTheDocument()
    expect(screen.queryByText('Wuse Clinic')).not.toBeInTheDocument()
  })

  it('gives the pending row an accessible Review button', () => {
    render(<ClaimsSection />)
    expect(screen.getByRole('button', { name: 'Review Garki Pharmacy' })).toBeInTheDocument()
  })

  it('approves from the drawer and closes it', async () => {
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Garki Pharmacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(actions.approveClaim).toHaveBeenCalledWith({ id: 'c1', businessId: 'b1' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rejects only after the confirmation runs', () => {
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Garki Pharmacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reject' }))
    const call = admin.askConfirm.mock.calls[0][0]
    expect(call.title).toBe('Reject this claim?')
    expect(typeof call.consequence).toBe('string')
    expect(call.consequence.length).toBeGreaterThan(0)
    expect(actions.rejectClaim).not.toHaveBeenCalled()
    admin.askConfirm.mock.calls[0][0].action()
    expect(actions.rejectClaim).toHaveBeenCalledWith('c1')
  })

  it('keeps the drawer open and shows the error when approve fails', async () => {
    actions.approveClaim.mockResolvedValue({ ok: false, error: 'Not allowed' })
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Garki Pharmacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers no decision on a claim that is already decided', () => {
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Wuse Clinic' }))
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows Retry, not an empty queue, when the list failed', () => {
    queues.value = { ...queues.value, claims: { status: 'error' } }
    render(<ClaimsSection />)
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
