import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const finance = vi.hoisted(() => ({ result: null }))

vi.mock('../hooks/useFinanceData', async (importActual) => ({
  ...(await importActual()),
  useFinanceData: () => finance.result,
}))

import OrdersSection from './OrdersSection.jsx'

const now = new Date().toISOString()
const tx = (n, over = {}) => ({
  id: n, type: 'topup', description: `Order number ${n}`, user_id: `user-${n}`,
  naira_amount: 1000, status: 'completed', created_at: now, ...over,
})
const loaded = (list) => ({
  data: { transactions: { status: 'ok', data: list }, withdrawals: { status: 'ok', data: [] } },
  isLoading: false, refetch: vi.fn(),
})
const sixteen = Array.from({ length: 16 }, (_, i) => tx(i + 1))
const search = () => screen.getByRole('textbox', { name: 'Search transactions' })
const statusSelect = () => screen.getByRole('combobox', { name: 'Filter by status' })

beforeEach(() => { finance.result = loaded([tx(1), tx(2, { description: 'Pharmacy refill', user_id: 'ABC-77', status: 'pending' }), tx(3, { status: 'failed' })]) })

describe('OrdersSection', () => {
  it('has one h1 and the scope subtitle', () => {
    render(<OrdersSection />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByText('Wallet transactions, latest 50')).toBeInTheDocument()
    expect(search()).toHaveAttribute('placeholder', 'Search within these 50…')
  })

  it('searches the description, case-insensitively', () => {
    render(<OrdersSection />)
    fireEvent.change(search(), { target: { value: 'PHARMACY' } })
    expect(screen.getByText('Pharmacy refill')).toBeInTheDocument()
    expect(screen.queryByText('Order number 1')).not.toBeInTheDocument()
    expect(screen.getByText('1 results · page 1/1')).toBeInTheDocument()
  })

  it('searches the user id', () => {
    render(<OrdersSection />)
    fireEvent.change(search(), { target: { value: 'abc-77' } })
    expect(screen.getByText('Pharmacy refill')).toBeInTheDocument()
    expect(screen.queryByText('Order number 3')).not.toBeInTheDocument()
  })

  it('filters by status', () => {
    render(<OrdersSection />)
    fireEvent.change(statusSelect(), { target: { value: 'failed' } })
    expect(screen.getByText('Order number 3')).toBeInTheDocument()
    expect(screen.queryByText('Order number 1')).not.toBeInTheDocument()
    expect(within(statusSelect()).getAllByRole('option').map(o => o.value)).toEqual(['', 'completed', 'pending', 'failed'])
  })

  it('pages 15 at a time with a 1-indexed display', () => {
    finance.result = loaded(sixteen)
    render(<OrdersSection />)
    expect(screen.getByText('16 results · page 1/2')).toBeInTheDocument()
    expect(screen.getByText('Order number 15')).toBeInTheDocument()
    expect(screen.queryByText('Order number 16')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('16 results · page 2/2')).toBeInTheDocument()
    expect(screen.getByText('Order number 16')).toBeInTheDocument()
    expect(screen.queryByText('Order number 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('returns to the first page when the search or the status changes', () => {
    finance.result = loaded(sixteen)
    render(<OrdersSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    fireEvent.change(search(), { target: { value: 'order' } })
    expect(screen.getByText('16 results · page 1/2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    fireEvent.change(statusSelect(), { target: { value: 'completed' } })
    expect(screen.getByText('16 results · page 1/2')).toBeInTheDocument()
  })

  it('shows the amount as stored, not divided by 100', () => {
    finance.result = loaded([tx(1, { naira_amount: 250000 }), tx(2, { naira_amount: null })])
    render(<OrdersSection />)
    expect(screen.getByText('₦250,000')).toBeInTheDocument()
    expect(screen.getByText('₦0')).toBeInTheDocument()
  })

  it('states what the amount and the filters cover', () => {
    render(<OrdersSection />)
    expect(screen.getByText('Amount as stored (naira_amount). Search and filters cover these 50 transactions only.')).toBeInTheDocument()
  })

  it('shows a failed source as failed with Retry, never as no transactions', () => {
    finance.result = { data: { transactions: { status: 'error' }, withdrawals: { status: 'ok', data: [] } }, isLoading: false, refetch: vi.fn() }
    render(<OrdersSection />)
    expect(screen.getByText("Couldn't load transactions.")).toBeInTheDocument()
    expect(screen.queryByText('No transactions found')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(finance.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('says no transactions found when the source loaded but nothing matches', () => {
    render(<OrdersSection />)
    fireEvent.change(search(), { target: { value: 'zzz-nothing' } })
    expect(screen.getByText('No transactions found')).toBeInTheDocument()
    expect(screen.getByText('0 results · page 1/1')).toBeInTheDocument()
  })

  it('refreshes through refetch', () => {
    render(<OrdersSection />)
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    expect(finance.result.refetch).toHaveBeenCalledTimes(1)
  })
})
