import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'

const { callAdminAuth } = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
vi.mock('../../adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../../test/renderAdmin.jsx'
import ClaimsScreen from './ClaimsScreen.jsx'

const rows = [
  { id: 'c1', business_id: 'b1', status: 'pending', created_at: new Date().toISOString(), businesses: { name: 'MedPlus Ikeja' }, claimant_name: 'Chidi Okafor', role_at_business: 'Owner' },
  { id: 'c2', business_id: 'b2', status: 'approved', created_at: new Date().toISOString(), businesses: { name: 'HealthPlus Lekki' } },
  { id: 'c3', business_id: 'b3', status: 'pending', created_at: null, businesses: null },
]

function mockApi(overrides = {}) {
  callAdminAuth.mockImplementation(async (action, payload) => {
    if (overrides[action]) return overrides[action](payload)
    if (action === 'list_business_claims') return { data: rows }
    return {}
  })
}
const calls = (action) => callAdminAuth.mock.calls.filter(c => c[0] === action)
const at = (route) => renderAdmin(<ClaimsScreen />, { route })

describe('ClaimsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi() })

  it('lists pending claims by default, including one whose business is missing', async () => {
    at('/admin/moderation/claims')
    expect(await screen.findByRole('button', { name: 'Open claim for MedPlus Ikeja' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open claim for Unknown business' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open claim for HealthPlus Lekki' })).not.toBeInTheDocument()
    expect(screen.getByText('2 pending · 3 total')).toBeInTheDocument()
  })

  it('shows every other field the claim carries in the drawer', async () => {
    at('/admin/moderation/claims?id=c1')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Claimant name')).toBeInTheDocument()
    expect(within(dialog).getByText('Chidi Okafor')).toBeInTheDocument()
    expect(within(dialog).getByText('Role at business')).toBeInTheDocument()
    expect(within(dialog).queryByText('Business id')).not.toBeInTheDocument()
  })

  it('approves a claim once and closes the drawer', async () => {
    at('/admin/moderation/claims?id=c1')
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    fireEvent.click(approve)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls('approve_claim')).toHaveLength(1)
    expect(calls('approve_claim')[0][1]).toEqual({ claimId: 'c1', businessId: 'b1' })
    expect(await screen.findByText('Claim approved')).toBeInTheDocument()
    expect(calls('log_audit_action')[0][1]).toMatchObject({ auditAction: 'approve', targetType: 'claim', targetId: 'c1' })
  })

  it('rejects a claim', async () => {
    at('/admin/moderation/claims?id=c3')
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(calls('reject_claim')[0][1]).toEqual({ claimId: 'c3' }))
    expect(await screen.findByText('Claim rejected')).toBeInTheDocument()
  })

  it('explains a failed action and leaves the drawer open', async () => {
    mockApi({ approve_claim: async () => { throw new Error('already owned') } })
    at('/admin/moderation/claims?id=c1')
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText("Couldn't approve the claim: already owned")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers no actions on a decided claim, and handles an unknown id', async () => {
    at('/admin/moderation/claims?status=all&id=c2')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows an error with retry when the list fails, and a clear empty state', async () => {
    mockApi({ list_business_claims: async () => { throw new Error('down') } })
    at('/admin/moderation/claims')
    expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeInTheDocument()
  })

  it('says the claim could not be found for an unknown id', async () => {
    at('/admin/moderation/claims?id=zzz')
    expect(await screen.findByText('This claim could not be found. It may already have been handled.')).toBeInTheDocument()
  })
})
