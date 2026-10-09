import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  notifications: { data: [], error: null },
  orders: { data: [], error: null },
  pending: false,
  orderIds: [],
  markRead: vi.fn(),
}))

vi.mock('../../config/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const q = {}
      q.select = () => q
      q.eq = () => q
      q.order = () => q
      q.limit = () => (h.pending ? new Promise(() => {}) : Promise.resolve(h.notifications))
      q.in = (_col, ids) => { h.orderIds.push(ids); return Promise.resolve(table === 'shop_orders' ? h.orders : { data: [], error: null }) }
      return q
    },
  },
}))
vi.mock('./repositories/profileRepository', () => ({ profileRepository: { markNotificationsRead: h.markRead } }))
// A stable object: the page reloads whenever `user` changes identity, as the real AuthContext keeps it stable.
vi.mock('../../providers/AuthContext', () => {
  const value = { user: { id: 'me' } }
  return { useAuth: () => value }
})
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({ useHeaderIdentity: () => ({ myUsername: 'me', myAvatar: null, unreadNotifs: 0 }) }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => children }))

import Notifications from './Notifications.jsx'

const ORDER_ID = '3f2b8c1e-5a47-4d9e-9b1a-0c6d7e8f9a10'
const NOW = new Date().toISOString()
const row = (over) => ({
  id: String(Math.random()), type: 'like', message: '', link: null, post_id: null, read: true,
  created_at: NOW, actor_id: null, profiles: null, ...over,
})

const PAYMENT = row({
  id: 'pay', type: 'shop_payment', read: false,
  message: 'Payment confirmed for order CF-000045', link: `/orders/${ORDER_ID}`,
})
const LIKE = row({ id: 'like', type: 'like', message: 'liked your post', post_id: 'p1', link: '/', actor_id: 'a1', profiles: { full_name: 'Ada Obi', display_name: 'ada' } })

function renderPage() {
  return render(<MemoryRouter><Notifications /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.notifications = { data: [], error: null }
  h.orders = { data: [], error: null }
  h.pending = false
  h.orderIds = []
  h.markRead.mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('Notifications page', () => {
  it('shows a loading state', () => {
    h.pending = true
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading notifications')
  })

  it('shows an empty state that says what to expect', async () => {
    renderPage()
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
    expect(screen.getByText(/order and payment updates/i)).toBeInTheDocument()
  })

  it('shows an error state with a working retry', async () => {
    h.notifications = { data: null, error: { message: 'boom' } }
    renderPage()
    expect(await screen.findByText("We couldn't load your notifications")).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()

    h.notifications = { data: [LIKE], error: null }
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText(/liked your post/)).toBeInTheDocument()
  })

  it('a payment confirmation has a headline, its sentence and, once the order loads, the total and items', async () => {
    h.notifications = { data: [PAYMENT], error: null }
    h.orders = { data: [{ id: ORDER_ID, total_kobo: 1850000, shop_order_items: [{ product_name: 'Paracetamol 500mg', quantity: 2 }, { product_name: 'Vitamin C', quantity: 1 }] }], error: null }
    renderPage()

    const item = (await screen.findByText('Payment confirmed')).closest('li')
    expect(within(item).getByText('Payment confirmed for order CF-000045')).toBeInTheDocument()
    expect(await within(item).findByText('₦18,500')).toBeInTheDocument()
    expect(within(item).getByText('2× Paracetamol 500mg +1 more')).toBeInTheDocument()
    expect(within(item).getByRole('link')).toHaveAttribute('href', `/orders/${ORDER_ID}`)
    expect(within(item).getByRole('img', { name: 'Unread' })).toBeInTheDocument()
    expect(screen.queryByText(/someone/i)).toBeNull()
  })

  it('asks for the orders of every purchase row in ONE query', async () => {
    const other = '9a8b7c6d-1111-4222-8333-444455556666'
    h.notifications = { data: [PAYMENT, row({ id: 'p2', type: 'shop_payment', message: 'Payment confirmed for order CF-2', link: `/orders/${other}` }), row({ id: 'p3', type: 'shop_payment', message: 'again', link: `/orders/${ORDER_ID}` }), LIKE], error: null }
    renderPage()
    await screen.findAllByText('Payment confirmed')
    await waitFor(() => expect(h.orderIds).toHaveLength(1))
    expect(h.orderIds[0].sort()).toEqual([other, ORDER_ID].sort())
  })

  it('does not look up orders when there are no purchase notifications', async () => {
    h.notifications = { data: [LIKE], error: null }
    renderPage()
    await screen.findByText(/liked your post/)
    expect(h.orderIds).toEqual([])
  })

  it('still shows every row, just without order detail, when the order lookup fails', async () => {
    h.notifications = { data: [PAYMENT], error: null }
    h.orders = { data: null, error: { message: 'permission denied' } }
    renderPage()
    expect(await screen.findByText('Payment confirmed')).toBeInTheDocument()
    await waitFor(() => expect(console.warn).toHaveBeenCalledWith('[notifications] order detail unavailable', 'permission denied'))
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('says an order status the way the order page does, not as a database key', async () => {
    h.notifications = { data: [row({ id: 's', type: 'shop_order_status', message: 'Order CF-000045 is now ready_for_pickup', link: `/orders/${ORDER_ID}` })], error: null }
    renderPage()
    expect(await screen.findByText('Order ready for pickup')).toBeInTheDocument()
    expect(screen.getByText('Order CF-000045 is now ready for pickup')).toBeInTheDocument()
    expect(screen.queryByText(/ready_for_pickup/)).toBeNull()
  })

  it('a member action reads "<name> <what they did>" and opens the post', async () => {
    h.notifications = { data: [LIKE], error: null }
    renderPage()
    const name = await screen.findByText('Ada Obi')
    expect(name.tagName).toBe('STRONG')
    expect(name.closest('p')).toHaveTextContent('Ada Obi liked your post')
    expect(within(screen.getByRole('list')).getByRole('link')).toHaveAttribute('href', '/post/p1')
  })

  it('a row with no actor is a sentence, never "Someone"', async () => {
    h.notifications = { data: [
      row({ id: '1', type: 'live_invite', message: 'invited you to co-host an upcoming live: "Skin Q&A"', link: '/live-dashboard/1' }),
      row({ id: '2', type: 'like', message: 'liked your post' }),
      row({ id: '3', type: 'stock_alert', message: 'Vitamin C is back in stock', link: '/shop/abc' }),
    ], error: null }
    renderPage()
    // The name is a <strong> of its own, so the sentence is checked on its paragraph.
    const invite = await screen.findByText(/invited you to co-host an upcoming live/)
    expect(invite.closest('p')).toHaveTextContent('CareFind invited you to co-host an upcoming live: "Skin Q&A"')
    expect(screen.getByText(/liked your post/).closest('p')).toHaveTextContent('A former member liked your post')
    expect(screen.getByText('Back in stock')).toBeInTheDocument()
    expect(screen.queryByText(/someone/i)).toBeNull()
  })

  it('does not turn an external link into a clickable notification', async () => {
    h.notifications = { data: [row({ type: 'shop_payment', message: 'Payment confirmed for order CF-1', link: 'https://evil.example/pay' }), row({ type: 'shop_refund', message: 'Refund processed', link: '//evil.example' })], error: null }
    renderPage()
    await screen.findByText('Payment confirmed')
    expect(screen.queryAllByRole('link').filter((a) => /evil/.test(a.getAttribute('href') || ''))).toEqual([])
    // The "Feed" back-link in the header is the only link on the page.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/'])
  })

  it('renders the rows as a list', async () => {
    h.notifications = { data: [PAYMENT, LIKE], error: null }
    renderPage()
    await screen.findByText('Payment confirmed')
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('marks everything read once loaded, and a failure to do so does not break the page', async () => {
    h.notifications = { data: [PAYMENT], error: null }
    renderPage()
    await screen.findByText('Payment confirmed')
    await waitFor(() => expect(h.markRead).toHaveBeenCalledWith('me'))

    h.markRead.mockRejectedValue(new Error('rls'))
    h.notifications = { data: [LIKE, row({ id: 'u', read: false, type: 'follow', message: 'started following you', actor_id: 'a2', profiles: { full_name: 'Chi' } })], error: null }
    renderPage()
    expect(await screen.findAllByText(/started following you/)).not.toHaveLength(0)
    await waitFor(() => expect(console.warn).toHaveBeenCalledWith('[notifications] could not mark as read', 'rls'))
  })
})
