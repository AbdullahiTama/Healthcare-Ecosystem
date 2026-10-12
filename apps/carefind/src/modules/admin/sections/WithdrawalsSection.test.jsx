import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

const finance = vi.hoisted(() => ({ value: null, isLoading: false, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({ busy: null, rejectWithdrawal: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), confirming: false }))
vi.mock('../hooks/useFinanceData', () => ({
  useFinanceData: () => ({ data: finance.value, isLoading: finance.isLoading, refetch: finance.refetch }),
}))
vi.mock('../hooks/useWithdrawalActions', () => ({ useWithdrawalActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import WithdrawalsSection, { REJECT_CONSEQUENCE } from './WithdrawalsSection.jsx'

const EXPECTED_CONSEQUENCE =
  'Paystack is checked first. If the transfer failed or was never sent, the coins are refunded to the user. ' +
  'If Paystack says it was paid, the request is recorded as paid and nothing is refunded. ' +
  'If the transfer may still be sending, or Paystack cannot confirm it, the rejection is blocked and nothing changes. ' +
  'A request with no Paystack reference is refunded without asking Paystack.'

const wd = (over = {}) => ({
  id: 'w1', status: 'reserved', amount: 12,
  bank_name: 'GTBank', account_number: '0123456789', account_name: 'Ada Obi Savings',
  paystack_reference: 'cf_wd_ref_1',
  profiles: { full_name: 'Ada Obi', display_name: 'ada' },
  created_at: new Date().toISOString(),
  ...over,
})

const rows = () => [
  wd(),
  wd({ id: 'w2', status: 'processing', amount: 5, account_number: '9999000011', paystack_reference: null, profiles: { full_name: null, display_name: 'Bayo' } }),
  wd({ id: 'w3', status: 'completed', amount: 3, account_number: '5555444433', profiles: { full_name: 'Chika Eze' } }),
]

const setList = (list) => { finance.value = { transactions: { status: 'ok', data: [] }, withdrawals: list } }
const openReview = (name) => fireEvent.click(screen.getByRole('button', { name: `Review ${name}` }))
const dialog = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  setList({ status: 'ok', data: rows() })
  finance.isLoading = false
  finance.refetch.mockReset()
  actions.busy = null
  actions.rejectWithdrawal.mockReset()
  actions.rejectWithdrawal.mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
})

describe('WithdrawalsSection', () => {
  it('lists in-progress withdrawals by default, and All shows completed ones', () => {
    render(<WithdrawalsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Withdrawals' })).toBeInTheDocument()
    expect(screen.getByText('Ada Obi')).toBeInTheDocument()
    expect(screen.getByText('Bayo')).toBeInTheDocument()
    expect(screen.queryByText('Chika Eze')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('Chika Eze')).toBeInTheDocument()
  })

  it('shows the amount as coins with an estimated naira value at 200 per coin', () => {
    render(<WithdrawalsSection />)
    expect(screen.getByText('12 coins · about ₦2,400 at 200 per coin')).toBeInTheDocument()
    expect(screen.getByText('5 coins · about ₦1,000 at 200 per coin')).toBeInTheDocument()
  })

  it('masks the account number in the table and shows the full number in the drawer', () => {
    render(<WithdrawalsSection />)
    expect(screen.getByText('GTBank · ••••6789')).toBeInTheDocument()
    expect(screen.queryByText(/0123456789/)).not.toBeInTheDocument()
    openReview('Ada Obi')
    expect(dialog().getByText('0123456789')).toBeInTheDocument()
    expect(dialog().getByText('Ada Obi Savings')).toBeInTheDocument()
  })

  it('shows the Paystack reference only when the row has one', () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    expect(dialog().getByText('cf_wd_ref_1')).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Bayo')
    expect(dialog().queryByText('Paystack reference')).not.toBeInTheDocument()
  })

  it('offers Reject and refund only for reserved or processing withdrawals', () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    expect(dialog().getByRole('button', { name: 'Reject and refund' })).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Bayo')
    expect(dialog().getByRole('button', { name: 'Reject and refund' })).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    openReview('Chika Eze')
    expect(dialog().queryByRole('button', { name: 'Reject and refund' })).not.toBeInTheDocument()
  })

  it('asks for confirmation with the true consequence and rejects only when it is confirmed', async () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject and refund' }))
    expect(REJECT_CONSEQUENCE).toBe(EXPECTED_CONSEQUENCE)
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const call = admin.askConfirm.mock.calls[0][0]
    expect(call).toEqual(expect.objectContaining({
      title: 'Reject this withdrawal?',
      consequence: EXPECTED_CONSEQUENCE,
      confirmLabel: 'Reject and refund',
    }))
    expect(actions.rejectWithdrawal).not.toHaveBeenCalled()
    await act(async () => { await call.action() })
    expect(actions.rejectWithdrawal).toHaveBeenCalledTimes(1)
    expect(actions.rejectWithdrawal).toHaveBeenCalledWith('w1')
  })

  it('keeps the drawer open with the server message when the reject is refused', async () => {
    actions.rejectWithdrawal.mockResolvedValue({ ok: false, error: 'Paystack says the transfer is still in progress' })
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject and refund' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(screen.getByRole('alert')).toHaveTextContent('Paystack says the transfer is still in progress')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders the latest row after a refused reject: a now-completed request loses the button, the error stays', async () => {
    actions.rejectWithdrawal.mockResolvedValue({ ok: false, error: 'The transfer already succeeded at Paystack, so it was marked completed instead of refunded.' })
    const { rerender } = render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject and refund' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })

    const refreshed = rows().map(r => (r.id === 'w1' ? { ...r, status: 'completed' } : r))
    setList({ status: 'ok', data: refreshed })
    rerender(<WithdrawalsSection />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog().queryByRole('button', { name: 'Reject and refund' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('marked completed instead of refunded')
  })

  it('closes the drawer when the reject succeeds', async () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject and refund' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows Retry, not an empty queue, when the list failed', () => {
    setList({ status: 'error' })
    render(<WithdrawalsSection />)
    expect(screen.queryByText('Nothing in progress')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(finance.refetch).toHaveBeenCalled()
  })

  it('shows neither Retry nor an empty message while loading', () => {
    finance.value = undefined
    finance.isLoading = true
    render(<WithdrawalsSection />)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Nothing in progress')).not.toBeInTheDocument()
  })

  it('says nothing is in progress, and the All tab says there are no requests yet, when the list is empty', () => {
    setList({ status: 'ok', data: [] })
    render(<WithdrawalsSection />)
    expect(screen.getByText('Nothing in progress')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('No withdrawal requests yet')).toBeInTheDocument()
  })
})
