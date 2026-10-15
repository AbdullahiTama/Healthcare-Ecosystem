import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import OrdersTab from './OrdersTab.jsx'

// The reported defect: a customer paid, the vendor was notified, the customer saw a status update — and the order was
// absent from CareFind Admin. Cause: the Orders tab rendered `transactions` (the CareCoin wallet ledger), which a shop
// order never touches. shop_orders held 54 rows; transactions held none of them.
vi.mock('../../../hooks/queries', () => ({ useAdminOrders: vi.fn() }))
vi.mock('../components/StatusDot', () => ({ StatusDot: () => null }))

import { useAdminOrders } from '../../../hooks/queries'

const paidOrder = {
  id: 'o-1',
  order_ref: 'CF-000027',
  customer_name: 'Ada Obi',
  payment_reference: 'pay_CF000027',
  payment_status: 'paid',
  status: 'paid',
  total_kobo: 125000,
  created_at: '2026-10-15T09:00:00.000Z',
  vendor_business_id: 'b-1',
  businesses: { name: 'Ada Pharmacy' },
  shop_order_items: [{ quantity: 2 }, { quantity: 1 }],
}

const setHook = (value) => useAdminOrders.mockReturnValue(value)

beforeEach(() => {
  vi.clearAllMocks()
  setHook({ data: { orders: [paidOrder], count: 1 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() })
})

describe('OrdersTab reads shop orders', () => {
  it('shows a PAID order, which the old transactions-backed tab could never render', async () => {
    render(<OrdersTab businesses={[]} />)
    expect(await screen.findByText('CF-000027')).toBeInTheDocument()
    expect(screen.getByText('Ada Obi')).toBeInTheDocument()
    expect(screen.getByText('Ada Pharmacy')).toBeInTheDocument()
    expect(screen.getByText('₦1,250')).toBeInTheDocument()
  })

  it('shows the receipt / payment reference, the thing an operator reads off an email receipt', async () => {
    render(<OrdersTab businesses={[]} />)
    expect(await screen.findByText('pay_CF000027')).toBeInTheDocument()
  })

  it('renders the order state, not a wallet transaction type', async () => {
    render(<OrdersTab businesses={[]} />)
    await screen.findByText('CF-000027')
    // "paid" legitimately appears twice: the payment state and the order state are separate columns on purpose.
    expect(screen.getAllByText('paid').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/gift_sent|withdrawal_refund|topup/)).toBeNull()
  })

  it('offers only statuses the order table actually allows', async () => {
    render(<OrdersTab businesses={[]} />)
    const select = await screen.findByLabelText(/filter by order status/i)
    const values = [...select.options].map((o) => o.value).filter(Boolean)
    // The old dropdown offered completed / pending / failed: values `shop_orders` never holds, so picking any returned
    // zero rows for every order that has ever existed.
    expect(values).toEqual(expect.arrayContaining(['paid', 'delivered', 'cancelled', 'in_transit', 'packed']))
    expect(values).not.toContain('completed')
    expect(values).not.toContain('failed')
  })

  it('asks the server for a filtered page rather than filtering a truncated client-side list', async () => {
    render(<OrdersTab businesses={[]} />)
    await screen.findByText('CF-000027')
    fireEvent.change(screen.getByLabelText(/filter by order status/i), { target: { value: 'delivered' } })
    await waitFor(() => {
      const last = useAdminOrders.mock.calls.at(-1)[0]
      expect(last.status).toBe('delivered')
      expect(last.page).toBe(1)
      expect(last.pageSize).toBe(25)
    })
  })

  it('paginates against the server total, not the rows it happens to hold', async () => {
    setHook({ data: { orders: [paidOrder], count: 54 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() })
    render(<OrdersTab businesses={[]} />)
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText(/54 orders/)).toBeInTheDocument()
  })

  it('surfaces a failed query instead of pretending the platform has no orders', async () => {
    // The previous hooks answered `.catch(() => ({ data: [] }))`, so a broken query was indistinguishable from an
    // empty day. This is the failure mode that let a missing order look like nothing was wrong.
    setHook({ data: undefined, isLoading: false, isFetching: false, error: new Error('Could not find a relationship between shop_orders and businesses'), refetch: vi.fn() })
    render(<OrdersTab businesses={[]} />)
    await waitFor(() => expect(screen.getByText(/Could not load orders/i)).toBeInTheDocument())
    expect(screen.queryByText(/No orders yet/i)).toBeNull()
  })

  it('distinguishes "no orders match these filters" from "no orders yet"', async () => {
    setHook({ data: { orders: [], count: 0 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() })
    render(<OrdersTab businesses={[]} />)
    expect(await screen.findByText('No orders yet')).toBeInTheDocument()

    setHook({ data: { orders: [], count: 0 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() })
    render(<OrdersTab businesses={[]} />)
    fireEvent.change(screen.getAllByLabelText(/search orders/i)[0], { target: { value: 'CF-999999' } })
    await waitFor(() => expect(screen.getByText('No orders match these filters')).toBeInTheDocument())
  })

  it('shows a loading state rather than an empty table while the query is in flight', async () => {
    setHook({ data: undefined, isLoading: true, isFetching: true, error: null, refetch: vi.fn() })
    render(<OrdersTab businesses={[]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading orders/i)
  })

  it('falls back to the business name from the loaded list when the order has no embedded vendor', async () => {
    const orphan = { ...paidOrder, businesses: null, vendor_business_id: 'b-9' }
    setHook({ data: { orders: [orphan], count: 1 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() })
    render(<OrdersTab businesses={[{ id: 'b-9', name: 'Fallback Pharmacy' }]} />)
    // Twice on purpose: once as the vendor filter option, once in the order's own row.
    expect((await screen.findAllByText('Fallback Pharmacy')).length).toBeGreaterThanOrEqual(2)
  })

  it('never renders a full account number; only the masked reference the order already stores', async () => {
    render(<OrdersTab businesses={[]} />)
    await screen.findByText('CF-000027')
    expect(document.body.textContent).not.toMatch(/\b\d{10}\b/)
  })
})