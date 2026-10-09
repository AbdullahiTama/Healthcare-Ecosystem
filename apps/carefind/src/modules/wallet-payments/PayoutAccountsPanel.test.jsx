import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../config/supabaseClient.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))

import PayoutAccountsPanel from './PayoutAccountsPanel.jsx'

function fakeManager(state, over = {}) {
  const base = { loading: false, loadError: '', kyc: { verified: false }, accounts: [], required: false, busy: '', error: '', code: '', codeSent: false, sentTo: '' }
  const s = { ...base, ...state }
  return {
    getState: () => s,
    subscribe: () => () => {},
    load: vi.fn(), clearError: vi.fn(),
    verifyIdentity: vi.fn(async () => true), sendCode: vi.fn(), addAccount: vi.fn(),
    setDefault: vi.fn(async () => true), remove: vi.fn(async () => true),
    ...over,
  }
}
const props = (manager, extra = {}) => ({ manager, selectedId: '', onSelect: vi.fn(), banks: [], banksStatus: 'ready', onRetryBanks: vi.fn(), isMobile: false, ...extra })
const ACCOUNTS = [
  { id: 'a1', bankName: 'GTBank', accountLast4: '6789', accountName: 'ADA OBI', isDefault: true },
  { id: 'a2', bankName: 'Zenith Bank', accountLast4: '1111', accountName: 'ADA OBI', isDefault: false },
]

describe('PayoutAccountsPanel', () => {
  it('shows a loading state, then an error with retry', () => {
    const { rerender } = render(<PayoutAccountsPanel {...props(fakeManager({ loading: true }))} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    const m = fakeManager({ loadError: 'Could not load your payout details. Try again.' })
    rerender(<PayoutAccountsPanel {...props(m)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(m.load).toHaveBeenCalled()
  })

  it('unverified: asks for BVN + NIN, keeps the numbers masked, and only submits 11+11 digits', async () => {
    const m = fakeManager({})
    render(<PayoutAccountsPanel {...props(m)} />)
    const bvn = screen.getByLabelText(/BVN/)
    const nin = screen.getByLabelText(/NIN/)
    expect(bvn).toHaveAttribute('type', 'password')
    expect(nin).toHaveAttribute('type', 'password')
    const submit = screen.getByRole('button', { name: 'Verify identity' })
    expect(submit).toBeDisabled()
    fireEvent.change(bvn, { target: { value: '2222222222a2' } }) // non-digits stripped, capped at 11
    fireEvent.change(nin, { target: { value: '11111111111' } })
    expect(bvn.value).toBe('22222222222')
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)
    await waitFor(() => expect(m.verifyIdentity).toHaveBeenCalledWith({ bvn: '22222222222', nin: '11111111111' }))
    await waitFor(() => expect(screen.getByLabelText(/BVN/).value).toBe('')) // cleared after use
  })

  it('unverified: adding an account is blocked and explained', () => {
    render(<PayoutAccountsPanel {...props(fakeManager({}))} />)
    expect(screen.getByRole('button', { name: '+ Add account' })).toBeDisabled()
    expect(screen.getByText(/Verify your identity, then add/)).toBeInTheDocument()
  })

  it('verified: shows who is verified (last four only) and the empty state', () => {
    render(<PayoutAccountsPanel {...props(fakeManager({ kyc: { verified: true, legalName: 'ADA CHINYERE OBI', bvnLast4: '1234' } }))} />)
    expect(screen.getByText(/Identity verified/)).toBeInTheDocument()
    expect(screen.getByText(/ADA CHINYERE OBI/)).toBeInTheDocument()
    expect(screen.getByText(/••••1234/)).toBeInTheDocument()
    expect(screen.getByText(/No payout account yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add account' })).not.toBeDisabled()
  })

  it('lists masked accounts as a radio group; choosing one reports it; default is marked', () => {
    const m = fakeManager({ kyc: { verified: true, legalName: 'ADA OBI', bvnLast4: '1' }, accounts: ACCOUNTS })
    const p = props(m, { selectedId: 'a1' })
    render(<PayoutAccountsPanel {...p} />)
    expect(screen.getByRole('radiogroup', { name: 'Withdraw to' })).toBeInTheDocument()
    expect(screen.getByText('DEFAULT')).toBeInTheDocument()
    expect(screen.getByText(/••••6789/)).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toBeChecked()
    fireEvent.click(radios[1])
    expect(p.onSelect).toHaveBeenCalledWith('a2')
    fireEvent.click(screen.getByRole('button', { name: /Make default/ }))
    expect(m.setDefault).toHaveBeenCalledWith('a2')
  })

  it('removing an account needs the PIN and passes it through', async () => {
    const m = fakeManager({ kyc: { verified: true, legalName: 'ADA OBI', bvnLast4: '1' }, accounts: ACCOUNTS })
    render(<PayoutAccountsPanel {...props(m, { selectedId: 'a1' })} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0])
    const confirm = screen.getByRole('button', { name: 'Remove account' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Withdrawal PIN to confirm/), { target: { value: '1234' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith({ id: 'a1', pin: '1234' }))
  })
})
