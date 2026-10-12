import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const finance = vi.hoisted(() => ({ result: null }))
const csv = vi.hoisted(() => ({ exportCSV: vi.fn() }))

vi.mock('../hooks/useFinanceData', async (importActual) => ({
  ...(await importActual()),
  useFinanceData: () => finance.result,
}))
vi.mock('../ui', async (importActual) => ({ ...(await importActual()), exportCSV: csv.exportCSV }))

import RevenueSection from './RevenueSection.jsx'

const now = new Date().toISOString()
// The Task 1 legacy fixture: three top-ups of any status and one withdrawal request.
const rows = [
  { id: 1, type: 'topup', description: 'Wallet top-up', amount: 1250, naira_amount: 250000, status: 'completed', created_at: now },
  { id: 2, type: 'topup', description: 'Card top-up', amount: 250, naira_amount: 50000, status: 'failed', created_at: now },
  { id: 3, type: 'topup', description: 'Manual top-up', amount: 10, naira_amount: null, status: 'pending', created_at: now },
  { id: 4, type: 'withdrawal', description: 'Cash out', amount: 500, naira_amount: null, status: 'pending', created_at: now },
]
const loaded = (list = rows) => ({
  data: { transactions: { status: 'ok', data: list }, withdrawals: { status: 'ok', data: [] } },
  isLoading: false, refetch: vi.fn(),
})
const failed = () => ({
  data: { transactions: { status: 'error' }, withdrawals: { status: 'ok', data: [] } },
  isLoading: false, refetch: vi.fn(),
})
const cell = (label) => screen.getByText(label).closest('div')

beforeEach(() => {
  finance.result = loaded()
  csv.exportCSV.mockReset()
})

describe('RevenueSection', () => {
  it('has one h1, labels every metric with its scope, and keeps the legacy maths', () => {
    render(<RevenueSection />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Revenue' })).toBeInTheDocument()
    expect(screen.getByText('Wallet transactions, latest 50')).toBeInTheDocument()
    expect(within(cell('Top-ups (latest 50)')).getByText('₦3,000')).toBeInTheDocument()
    expect(within(cell('Top-ups (latest 50)')).getByText('Sum of top-ups of any status')).toBeInTheDocument()
    expect(within(cell('Top-up count (latest 50)')).getByText('3')).toBeInTheDocument()
    expect(within(cell('Withdrawal requests (latest 50)')).getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Latest 50 transactions' })).toBeInTheDocument()
  })

  it('shows a failed source as failed on every metric and the table, never as zero or empty', () => {
    finance.result = failed()
    render(<RevenueSection />)
    expect(screen.queryByText('₦0')).not.toBeInTheDocument()
    expect(screen.queryByText('No transactions in the latest 50')).not.toBeInTheDocument()
    expect(within(cell('Top-ups (latest 50)')).getByText(/Couldn't load/)).toBeInTheDocument()
    expect(within(cell('Top-up count (latest 50)')).getByText(/Couldn't load/)).toBeInTheDocument()
    expect(within(cell('Withdrawal requests (latest 50)')).getByText(/Couldn't load/)).toBeInTheDocument()
    expect(screen.getByText("Couldn't load transactions.")).toBeInTheDocument()
    const retries = screen.getAllByRole('button', { name: 'Retry' })
    expect(retries).toHaveLength(4)
    fireEvent.click(retries[0])
    fireEvent.click(retries[3])
    expect(finance.result.refetch).toHaveBeenCalledTimes(2)
  })

  it('shows loading placeholders, not numbers, while the source loads', () => {
    finance.result = { data: undefined, isLoading: true, refetch: vi.fn() }
    render(<RevenueSection />)
    expect(screen.getByRole('status', { name: 'Loading Top-ups (latest 50)' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading Top-up count (latest 50)' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading Withdrawal requests (latest 50)' })).toBeInTheDocument()
    expect(screen.queryByText('₦0')).not.toBeInTheDocument()
    expect(screen.queryByText('No transactions in the latest 50')).not.toBeInTheDocument()
  })

  it('says so when a loaded source has no transactions', () => {
    finance.result = loaded([])
    render(<RevenueSection />)
    expect(screen.getByText('No transactions in the latest 50')).toBeInTheDocument()
    expect(within(cell('Top-ups (latest 50)')).getByText('₦0')).toBeInTheDocument()
  })

  it('shows the status badge and the legacy naira format, with a dash for no amount', () => {
    render(<RevenueSection />)
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getAllByText('Pending')).toHaveLength(2)
    expect(screen.getByText('₦2,500')).toBeInTheDocument()
    expect(screen.getByText('₦500')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('exports the loaded rows, and is disabled with none', () => {
    const { unmount } = render(<RevenueSection />)
    fireEvent.click(screen.getByRole('button', { name: /Export CSV \(latest 50\)/ }))
    expect(csv.exportCSV).toHaveBeenCalledWith(rows, 'transactions.csv')
    unmount()
    finance.result = loaded([])
    render(<RevenueSection />)
    expect(screen.getByRole('button', { name: /Export CSV \(latest 50\)/ })).toBeDisabled()
  })
})
