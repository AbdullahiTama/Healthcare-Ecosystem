import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const ctrl = vi.hoisted(() => ({
  result: { data: [], error: null },
  pending: false,
  updates: [],
  selected: null,
}))

vi.mock('../../config/supabaseClient', () => ({
  supabase: {
    from: () => {
      const q = {}
      q.select = (cols) => { ctrl.selected = cols; return q }
      q.eq = () => q
      q.order = () => q
      q.limit = () => (ctrl.pending ? new Promise(() => {}) : Promise.resolve(ctrl.result))
      q.update = (patch) => { ctrl.updates.push(patch); return q }
      q.then = (resolve) => resolve({ error: null })
      return q
    },
  },
}))
// A stable object: the page reloads whenever `user` changes identity, exactly as
// the real AuthContext keeps it stable between renders.
vi.mock('../../providers/AuthContext', () => {
  const value = { user: { id: 'me' } }
  return { useAuth: () => value }
})
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({ useHeaderIdentity: () => ({ myUsername: 'me', myAvatar: null, unreadNotifs: 0 }) }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => children }))

import Notifications from './Notifications.jsx'

const NOW = new Date().toISOString()
const row = (over) => ({
  id: String(Math.random()), type: 'like', title: null, message: '', metadata: {}, link: null, post_id: null,
  read: true, created_at: NOW, actor_id: null, profiles: null, ...over,
})

const PAYMENT = row({
  id: 'pay1', type: 'payment_topup', read: false,
  title: 'Wallet top-up successful',
  message: 'You paid ₦5,000 and 25 CareCoins were added to your wallet. New balance: 40 CareCoins.',
  metadata: { amount_kobo: 500000, coins: 25, reference: 'cf_u1_abc' },
  link: '/wallet',
})

function renderPage() {
  return render(<MemoryRouter><Notifications /></MemoryRouter>)
}

describe('Notifications page', () => {
  beforeEach(() => { ctrl.result = { data: [], error: null }; ctrl.pending = false; ctrl.updates = [] })
  afterEach(cleanup)

  it('asks for the structured columns', async () => {
    renderPage()
    await screen.findByText('No notifications yet')
    expect(ctrl.selected).toMatch(/\btitle\b/)
    expect(ctrl.selected).toMatch(/\bmetadata\b/)
  })

  it('shows a loading state', () => {
    ctrl.pending = true
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading notifications')
  })

  it('shows an empty state that says what to expect', async () => {
    renderPage()
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
    expect(screen.getByText(/payment confirmations/i)).toBeInTheDocument()
  })

  it('shows an error state with a working retry', async () => {
    ctrl.result = { data: null, error: { message: 'boom' } }
    renderPage()
    expect(await screen.findByText("We couldn't load your notifications")).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()

    ctrl.result = { data: [PAYMENT], error: null }
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Wallet top-up successful')).toBeInTheDocument()
  })

  it('renders a payment as headline, detail and the facts that matter', async () => {
    ctrl.result = { data: [PAYMENT], error: null }
    renderPage()

    const item = (await screen.findByText('Wallet top-up successful')).closest('li')
    expect(within(item).getByText('Payment')).toBeInTheDocument()
    expect(within(item).getByText(/You paid ₦5,000 and 25 CareCoins were added/)).toBeInTheDocument()
    expect(within(item).getByText('Amount').nextSibling).toHaveTextContent('₦5,000')
    expect(within(item).getByText('CareCoins').nextSibling).toHaveTextContent('25')
    expect(within(item).getByText('Ref').nextSibling).toHaveTextContent('cf_u1_abc')
    expect(within(item).getByRole('link')).toHaveAttribute('href', '/wallet')
    expect(within(item).getByRole('img', { name: 'Unread' })).toBeInTheDocument()
  })

  it('renders activity as "<name> <what they did>"', async () => {
    ctrl.result = { data: [row({ type: 'like', message: 'liked your post', actor_id: 'a1', profiles: { full_name: 'Ada Obi' } })], error: null }
    renderPage()
    const strong = await screen.findByText('Ada Obi')
    expect(strong.tagName).toBe('STRONG')
    expect(strong.closest('p')).toHaveTextContent('Ada Obi liked your post')
  })

  it('never says "Someone" — a notification with no actor reads as a complete sentence', async () => {
    ctrl.result = {
      data: [
        row({ id: '1', type: 'like', message: 'liked your post' }),
        row({ id: '2', type: 'follow', message: 'started following you' }),
        row({ id: '3', type: 'live_invite', message: 'invited you to co-host a live: "Skin Q&A"' }),
        row({ id: '4', type: 'product_available', message: 'a product you wanted is now available' }),
      ],
      error: null,
    }
    renderPage()
    expect(await screen.findByText('Your post received a like')).toBeInTheDocument()
    expect(screen.getByText('You have a new follower')).toBeInTheDocument()
    expect(screen.getByText('You were invited to co-host a live: "Skin Q&A"')).toBeInTheDocument()
    expect(screen.getByText('A product you wanted is now available')).toBeInTheDocument()
    expect(screen.queryByText(/someone/i)).toBeNull()
  })

  it('does not turn a hostile external link into a clickable notification', async () => {
    ctrl.result = { data: [row({ type: 'follow', message: 'started following you', actor_id: 'a1', profiles: { full_name: 'Mallory' }, link: 'https://evil.example/login' })], error: null }
    renderPage()
    await screen.findByText('Mallory')
    expect(screen.queryByRole('link', { name: /mallory/i })).toBeNull()
    expect(document.querySelector('a[href*="evil.example"]')).toBeNull()
  })

  it('does not present a forged payment notice as a payment', async () => {
    // No server title => not one we wrote; it must not get the Payment treatment.
    ctrl.result = { data: [row({ type: 'payment_topup', message: 'you won ₦1,000,000 — click here', actor_id: 'a1', profiles: { full_name: 'Mallory' } })], error: null }
    renderPage()
    await screen.findByText('Mallory')
    expect(screen.queryByText('Payment')).toBeNull()
  })

  it('marks everything read once loaded', async () => {
    ctrl.result = { data: [PAYMENT], error: null }
    renderPage()
    await screen.findByText('Wallet top-up successful')
    await waitFor(() => expect(ctrl.updates).toContainEqual({ read: true }))
  })
})
