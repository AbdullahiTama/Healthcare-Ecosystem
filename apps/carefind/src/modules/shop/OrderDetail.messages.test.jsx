// The chat is a secondary panel on the order page. If its messages cannot be loaded the order must still render,
// with an error in the chat panel - not "Order not found" for an order that exists.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const ORDER = {
  id: 'o1', order_ref: 'CF-ORDER-1', status: 'paid', payment_status: 'paid', customer_id: 'u1',
  total_kobo: 650000, subtotal_kobo: 650000, delivery_kobo: 0, fulfilment_kobo: 0, created_at: '2026-10-01T10:00:00Z',
  order_items: [{ id: 'i1', product_name: 'Paracetamol', quantity: 1, unit_price_kobo: 650000 }],
}
const h = vi.hoisted(() => ({ getMessages: null, addMessage: null, getById: null, startShopPayment: null }))
vi.mock('./orderRepository', () => ({
  orderRepository: {
    getById: (...a) => h.getById(...a),
    getMessages: (...a) => h.getMessages(...a),
    addMessage: (...a) => h.addMessage(...a),
  },
}))
vi.mock('./trackingRepository', () => ({ trackingRepository: { getTrackingEvents: async () => [] } }))
vi.mock('./vendorRatingRepository', () => ({ vendorRatingRepository: { getByOrder: async () => null } }))
vi.mock('./shopRepository', () => ({ shopRepository: { getPickupStationById: async () => null } }))
vi.mock('./shopPaymentService', () => ({ shopPaymentService: { startShopPayment: (...a) => h.startShopPayment(...a) } }))
vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('./CartProvider', () => ({ useCart: () => ({ addItem: vi.fn() }) }))
vi.mock('../../components/shop/DeliveryTrackingMap', () => ({ default: () => null }))
vi.mock('./VendorRating', () => ({ default: () => null }))

import OrderDetail from './OrderDetail'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/orders/o1']}>
      <Routes><Route path="/orders/:orderId" element={<OrderDetail />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { h.getById = async () => ({ ...ORDER }); h.startShopPayment = async () => ({ url: '/x' }) })

describe('OrderDetail chat messages', () => {
  it('still shows the order, with an error in the chat panel, when messages cannot be loaded', async () => {
    h.getMessages = async () => { throw { message: "Could not find a relationship between 'shop_order_messages' and 'sender_id' in the schema cache" } }
    mount()

    expect((await screen.findAllByText(/CF-ORDER-1/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/order not found/i)).toBeNull()
    expect(screen.getByText(/could not load messages/i)).toBeTruthy()
  })

  it('shows the messages and sender names when they load', async () => {
    h.getMessages = async () => [
      { id: 'm1', sender_id: 'u2', sender_role: 'vendor', message: 'Your order is packed', created_at: '2026-10-01T11:00:00Z', profiles: { id: 'u2', full_name: 'Pharma Ltd' } },
    ]
    mount()

    expect(await screen.findByText('Your order is packed')).toBeTruthy()
    expect(screen.getByText(/Pharma Ltd/)).toBeTruthy()
  })

  it('keeps the order on screen, with an error in the chat panel, when a message cannot be sent', async () => {
    h.getMessages = async () => []
    h.addMessage = async () => { throw { message: 'insert failed' } }
    mount()
    await screen.findAllByText(/CF-ORDER-1/)

    fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Is it ready?' } })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText(/could not send your message/i)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/order not found/i)).toBeNull())
    expect(screen.getAllByText(/CF-ORDER-1/).length).toBeGreaterThan(0)
  })

  it('reloads the messages after a successful send', async () => {
    let stored = []
    h.getMessages = async () => stored
    h.addMessage = async (_orderId, text) => { stored = [{ id: 'm9', sender_id: 'u1', sender_role: 'customer', message: text, created_at: '2026-10-01T12:00:00Z', profiles: { id: 'u1', full_name: 'Ada' } }] }
    mount()
    await screen.findAllByText(/CF-ORDER-1/)

    fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Is it ready?' } })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    expect(await screen.findByText('Is it ready?')).toBeTruthy()
  })
})

// A failed action on a loaded order is a banner on that order. A failed load is a retryable error - and neither is
// "Order not found", which is reserved for an order that really is not there.
describe('OrderDetail errors', () => {
  it('says the order could not be loaded, with a retry, when loading fails', async () => {
    h.getById = async () => { throw { message: 'network down' } }
    mount()

    expect(await screen.findByText(/could not load this order/i)).toBeTruthy()
    expect(screen.queryByText(/order not found/i)).toBeNull()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('retries the load from the error screen', async () => {
    let calls = 0
    h.getById = async () => { calls++; if (calls === 1) throw { message: 'network down' }; return { ...ORDER } }
    h.getMessages = async () => []
    mount()

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect((await screen.findAllByText(/CF-ORDER-1/)).length).toBeGreaterThan(0)
  })

  it('says order not found only when the order does not exist', async () => {
    h.getById = async () => null
    mount()

    expect(await screen.findByText(/order not found/i)).toBeTruthy()
  })

  it('keeps the order on screen and shows a banner when starting payment fails', async () => {
    h.getById = async () => ({ ...ORDER, status: 'pending_payment', payment_status: 'pending' })
    h.getMessages = async () => []
    h.startShopPayment = async () => { throw new Error('Could not check your earlier payment. Please try again in a moment.') }
    mount()
    await screen.findAllByText(/CF-ORDER-1/)

    fireEvent.click(screen.getByRole('button', { name: /pay with paystack/i }))

    expect(await screen.findByText(/could not check your earlier payment/i)).toBeTruthy()
    expect(screen.queryByText(/order not found/i)).toBeNull()
    expect(screen.getAllByText(/CF-ORDER-1/).length).toBeGreaterThan(0)
  })
})
