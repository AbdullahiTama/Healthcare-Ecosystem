import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

const finance = vi.hoisted(() => ({ value: null, isLoading: false, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({ busy: null, rejectWithdrawal: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn(), confirming: false }))
vi.mock('../hooks/useFinanceData', () => ({
  useFinanceData: () => ({ data: finance.value, isLoading: finance.isLoading, refetch: finance.refetch }),
}))
vi.mock('../hooks/useWithdrawalActions', () => ({ useWithdrawalActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import WithdrawalsSection, { REJECT_CONSEQUENCE, columns } from './WithdrawalsSection.jsx'

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
  admin.showToast.mockReset()
})

describe('WithdrawalsSection', () => {
  it('lists in-progress withdrawals by default, and All shows completed ones', () => {
    render(<WithdrawalsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Withdrawals' })).toBeInTheDocument()
    expect(screen.getByText('Withdrawals are paid out automatically. Reject only one that is stuck.')).toBeInTheDocument()
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

  // The spec: no more financial information than the legacy screen showed, and
  // the legacy WithdrawalsTab never showed the Paystack reference.
  it('shows only the fields the legacy screen showed, never the Paystack reference', () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    const terms = dialog().getAllByRole('term').map(t => t.textContent)
    expect(terms).toEqual(['Person', 'Amount', 'Bank', 'Account number', 'Account name', 'Status', 'Requested'])
    expect(dialog().queryByText('cf_wd_ref_1')).not.toBeInTheDocument()
    expect(dialog().queryByText('Paystack reference')).not.toBeInTheDocument()
  })

  it('names the person by display name when there is no full name', () => {
    render(<WithdrawalsSection />)
    openReview('Bayo')
    expect(dialog().getAllByText('Bayo').length).toBeGreaterThan(0)
  })

  it('offers Reject withdrawal only for reserved or processing withdrawals', () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    expect(dialog().getByRole('button', { name: 'Reject withdrawal' })).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Bayo')
    expect(dialog().getByRole('button', { name: 'Reject withdrawal' })).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    openReview('Chika Eze')
    expect(dialog().queryByRole('button', { name: 'Reject withdrawal' })).not.toBeInTheDocument()
  })

  it('asks for confirmation with the true consequence and rejects only when it is confirmed', async () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject withdrawal' }))
    expect(REJECT_CONSEQUENCE).toBe(EXPECTED_CONSEQUENCE)
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const call = admin.askConfirm.mock.calls[0][0]
    expect(call).toEqual(expect.objectContaining({
      title: 'Reject this withdrawal?',
      consequence: EXPECTED_CONSEQUENCE,
      confirmLabel: 'Reject withdrawal',
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
    fireEvent.click(dialog().getByRole('button', { name: 'Reject withdrawal' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reject the withdrawal: Paystack says the transfer is still in progress")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('names the Reject button "Rejecting…" and disables it while that withdrawal is being rejected', () => {
    actions.busy = 'w1'
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    const button = dialog().getByRole('button', { name: 'Rejecting…' })
    expect(button).toBeDisabled()
    expect(dialog().queryByRole('button', { name: 'Reject withdrawal' })).not.toBeInTheDocument()
  })

  it('renders the latest row after a refused reject: a now-completed request loses the button, the error stays', async () => {
    actions.rejectWithdrawal.mockResolvedValue({ ok: false, error: 'The transfer already succeeded at Paystack, so it was marked completed instead of refunded.' })
    const { rerender } = render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject withdrawal' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })

    const refreshed = rows().map(r => (r.id === 'w1' ? { ...r, status: 'completed' } : r))
    setList({ status: 'ok', data: refreshed })
    rerender(<WithdrawalsSection />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog().queryByRole('button', { name: 'Reject withdrawal' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reject the withdrawal: The transfer already succeeded")
  })

  it('closes the drawer when the reject succeeds', async () => {
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject withdrawal' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // A reject can take seconds (Paystack is asked). If the admin moves to another
  // withdrawal meanwhile, w1's late result must not land on w2's drawer.
  const startRejectThenOpenOther = async () => {
    let resolve
    actions.rejectWithdrawal.mockImplementation(() => new Promise(r => { resolve = r }))
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject withdrawal' }))
    let pending
    act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
    expect(actions.rejectWithdrawal).toHaveBeenCalledWith('w1')
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Bayo')
    expect(screen.getByRole('dialog')).toHaveTextContent('Bayo')
    return async (result) => { await act(async () => { resolve(result); await pending }) }
  }

  it('toasts a late refusal for w1 instead of showing it in the drawer of another withdrawal', async () => {
    const finishW1 = await startRejectThenOpenOther()
    await finishW1({ ok: false, error: 'still in progress' })
    expect(screen.getByRole('dialog')).toHaveTextContent('Bayo')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(admin.showToast).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't reject the withdrawal: still in progress", { type: 'error' })
  })

  it('does not close the drawer of another withdrawal, or toast, when w1 succeeds late', async () => {
    const finishW1 = await startRejectThenOpenOther()
    await finishW1({ ok: true })
    expect(screen.getByRole('dialog')).toHaveTextContent('Bayo')
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  // The confirm closes before the reject runs, so the drawer can be closed while
  // Paystack is asked. A refusal then has no drawer to land in: it must be toasted.
  const startRejectThenClose = () => {
    let resolve
    actions.rejectWithdrawal.mockImplementation(() => new Promise(r => { resolve = r }))
    render(<WithdrawalsSection />)
    openReview('Ada Obi')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject withdrawal' }))
    let pending
    act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    return async (result) => { await act(async () => { resolve(result); await pending }) }
  }

  it('toasts a refusal that arrives after the drawer was closed, and shows no inline alert', async () => {
    const finishW1 = startRejectThenClose()
    await finishW1({ ok: false, error: 'Paystack says the transfer is still in progress' })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't reject the withdrawal: Paystack says the transfer is still in progress", { type: 'error' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Reopening the same withdrawal does not resurrect a stale error either.
    openReview('Ada Obi')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not toast a success that arrives after the drawer was closed (the hook already did)', async () => {
    const finishW1 = startRejectThenClose()
    await finishW1({ ok: true })
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('sorts a request with no created_at deterministically, as time 0', () => {
    const requested = columns.find(c => c.key === 'created_at')
    expect(requested.sortValue(wd({ created_at: null }))).toBe(0)
    expect(requested.sortValue(wd({ created_at: undefined }))).toBe(0)
    expect(requested.sortValue(wd({ created_at: '2026-10-01T00:00:00Z' }))).toBe(Date.parse('2026-10-01T00:00:00Z'))
  })

  it('says nothing is in progress, and the All tab says there are no requests yet, when the list is empty', () => {
    setList({ status: 'ok', data: [] })
    render(<WithdrawalsSection />)
    expect(screen.getByText('Nothing in progress')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('No withdrawal requests yet')).toBeInTheDocument()
  })
})
