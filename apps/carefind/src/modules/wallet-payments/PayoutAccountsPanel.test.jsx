import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../config/supabaseClient.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))

import PayoutAccountsPanel from './PayoutAccountsPanel.jsx'

function fakeManager(state, over = {}) {
  const base = { limits: null, loading: false, loadError: '', kyc: { verified: false }, accounts: [], required: false, busy: '', error: '', code: '', codeSent: false, sentTo: '' }
  const s = { ...base, ...state }
  return {
    getState: () => s,
    subscribe: () => () => {},
    load: vi.fn(), clearError: vi.fn(),
    verifyIdentity: vi.fn(async () => true), verifySelfie: vi.fn(async () => true), sendCode: vi.fn(), addAccount: vi.fn(),
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

  const VERIFIED = { verified: true, legalName: 'ADA OBI', bvnLast4: '1234' }
  const LIMITS1 = { tier: 1, dailyCapKobo: 5000000, nextTierCapKobo: 50000000, cooloffHours: 24, cooloffCapKobo: 2000000 }

  it('shows the daily limit and, at tier 1, offers a selfie check to raise it', async () => {
    const m = fakeManager({ kyc: VERIFIED, limits: LIMITS1 })
    render(<PayoutAccountsPanel {...props(m, { showSelfie: true })} />)
    expect(screen.getByText(/Daily withdrawal limit: ₦50,000/)).toBeInTheDocument()
    expect(screen.getByText(/raises your daily limit to/)).toHaveTextContent('₦500,000')
    const submit = screen.getByRole('button', { name: 'Verify selfie' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/BVN/, { selector: '#selfie-bvn' }), { target: { value: '22222222222' } })
    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
    fireEvent.change(document.getElementById('selfie-file'), { target: { files: [file] } })
    expect(submit).not.toBeDisabled()
    expect(document.getElementById('selfie-file')).toHaveAttribute('capture', 'user')
  })

  it('an unreadable photo is explained and nothing is sent', async () => {
    const m = fakeManager({ kyc: VERIFIED, limits: LIMITS1 })
    render(<PayoutAccountsPanel {...props(m, { showSelfie: true })} />)
    fireEvent.change(screen.getByLabelText(/BVN/, { selector: '#selfie-bvn' }), { target: { value: '22222222222' } })
    fireEvent.change(document.getElementById('selfie-file'), { target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify selfie' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not a photo/))
    expect(m.verifySelfie).not.toHaveBeenCalled()
  })

  it('no selfie offer at tier 2 (it says so) or when the screen does not ask for it', () => {
    const { unmount } = render(<PayoutAccountsPanel {...props(fakeManager({ kyc: VERIFIED, limits: { ...LIMITS1, tier: 2, dailyCapKobo: 50000000, nextTierCapKobo: null } }), { showSelfie: true })} />)
    expect(screen.getByText(/selfie verified/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify selfie' })).toBeNull()
    unmount()
    render(<PayoutAccountsPanel {...props(fakeManager({ kyc: VERIFIED, limits: LIMITS1 }))} />)
    expect(screen.queryByRole('button', { name: 'Verify selfie' })).toBeNull()
  })

  it('a new account explains its cooling-off cap and when it ends', () => {
    const ends = new Date(Date.now() + 3 * 3600_000).toISOString()
    const accounts = [{ id: 'n1', bankName: 'GTBank', accountLast4: '6789', accountName: 'ADA OBI', isDefault: true, coolingEndsAt: ends }, { id: 'o1', bankName: 'Zenith', accountLast4: '1111', accountName: 'ADA OBI', isDefault: false, coolingEndsAt: null }]
    render(<PayoutAccountsPanel {...props(fakeManager({ kyc: VERIFIED, limits: LIMITS1, accounts }), { selectedId: 'n1' })} />)
    const notes = screen.getAllByRole('note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveTextContent(/limited to ₦20,000 in any 24 hours until/)
  })
})
