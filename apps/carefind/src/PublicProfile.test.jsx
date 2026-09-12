import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PublicProfile from './PublicProfile.jsx'

// Queue-based supabase mock (the newsArticle.test.jsx pattern): each awaited
// query resolves with the next queued result. For a logged-out visitor the
// load flow needs exactly: [profile, posts, follows, follows, stories,
// playlists, user_reviews].
const h = vi.hoisted(() => {
  const ctrl = { queue: [] }
  ctrl.push = (...results) => { ctrl.queue.push(...results); return ctrl }
  const query = () => {
    const q = {}
    q.select = vi.fn(() => q)
    q.eq = vi.fn(() => q)
    q.gt = vi.fn(() => q)
    q.order = vi.fn(() => q)
    q.limit = vi.fn(() => q)
    q.maybeSingle = vi.fn(() => q)
    q.single = vi.fn(() => q)
    q.in = vi.fn(() => q)
    q.insert = vi.fn(() => q)
    q.delete = vi.fn(() => q)
    q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
    return q
  }
  ctrl.from = vi.fn(() => query())
  ctrl.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return { ctrl }
})

vi.mock('./config/supabaseClient', () => ({ supabase: h.ctrl }))
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('./providers/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
vi.mock('./services/notify.js', () => ({ notify: vi.fn() }))
vi.mock('./hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('./hooks/useHeaderIdentity', () => ({ useHeaderIdentity: () => ({ myUsername: '', myAvatar: null, unreadNotifs: 0 }) }))
vi.mock('./components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('./components/layout/SidebarSection.jsx', () => ({
  StickySidebar: ({ children }) => <div>{children}</div>,
  SidebarSection: () => null,
}))
vi.mock('./components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('./modules/subscriptions-monetization/subscriptions.js', () => ({
  subscribe: vi.fn(async () => ({})),
  checkAccess: vi.fn(async () => ({ active: false, sub: null })),
  cancelAutoRenew: vi.fn(async () => {}),
  coinsToNaira: vi.fn(() => 0),
}))
vi.mock('./modules/subscriptions-monetization/consultations.js', () => ({
  coinsForConsultation: vi.fn(() => 0),
  fetchConsultationOffer: vi.fn(async () => null),
  hasBookedConsultation: vi.fn(async () => false),
  bookConsultationWithPaystackFallback: vi.fn(async () => ({})),
  settleConsultationCardPayment: vi.fn(async () => ({ ok: true })),
}))
vi.mock('./modules/social-feed/storyViews.js', () => ({
  fetchViewedStoryIds: vi.fn(async () => new Set()),
  markStoriesViewed: vi.fn(async () => null),
}))

const profile = {
  id: 'prof-1', full_name: 'Dr Ada', display_name: 'ada', is_verified: false,
  verification_label: null, location: null, website: null, avatar_url: null,
  cover_url: null, subscription_price: 0, bio: null, show_followers: true,
}

// Two stories whose Stories.jsx ordering (position → views → newest) puts
// s2 first: it has an explicit position, s1 is nulls-last.
const stories = [
  { id: 's1', title: 'Morning', body: 'Stay **calm**', image_url: null, bg_color: '#0E6F5A', created_at: '2026-08-01T10:00:00Z', position: null, view_count: 9 },
  { id: 's2', title: 'Tip', body: 'Drink **water**', image_url: null, bg_color: '#155A4B', created_at: '2026-08-02T10:00:00Z', position: 1, view_count: 1 },
]

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/u/prof-1']}>
      <Routes>
        <Route path="/u/:id" element={<PublicProfile />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  h.ctrl.queue.length = 0
  h.ctrl.from.mockClear()
  h.ctrl.rpc.mockClear()
  auth.user = null
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn()
})

describe('PublicProfile story ring — WhatsApp Status style (ring on avatar, no separate rail)', () => {
  it('shows a single avatar ring when stories exist, no separate rail circles, ordering is position → views → newest via viewer', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null }) // posts
    h.ctrl.push({ count: 0, error: null }) // follows (following_id)
    h.ctrl.push({ count: 0, error: null }) // follows (follower_id)
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null }) // playlists
    h.ctrl.push({ data: [], error: null }) // user_reviews

    renderProfile()

    // Single avatar ring, not per-story rail buttons
    const ring = await screen.findByRole('button', { name: "View Dr Ada's story" })
    expect(ring).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^View story:/ })).toBeNull()

    // Tapping ring opens viewer at first story in sorted order (Tip has position 1, so first)
    fireEvent.click(ring)
    expect(await screen.findByRole('heading', { name: 'Tip' })).toBeInTheDocument()

    // Next navigates sequentially to second story (Morning)
    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    expect(await screen.findByRole('heading', { name: 'Morning' })).toBeInTheDocument()
  })

  it('renders no ring button when the profile has no stories', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: [], error: null }) // no stories
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    await screen.findByRole('heading', { name: 'Dr Ada' })
    expect(screen.queryByRole('button', { name: /^View story:/ })).toBeNull()
    expect(screen.queryByRole('button', { name: "View Dr Ada's story" })).toBeNull()
  })

  it('tapping ring opens viewer directly without a chooser menu', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: "View Dr Ada's story" }))
    // No chooser — viewer appears immediately, no menuitems
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Tip' })).toBeInTheDocument()
  })

  it('viewer auto-advance: stories are ordered and accessible sequentially from ring', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: "View Dr Ada's story" }))
    expect(await screen.findByRole('heading', { name: 'Tip' })).toBeInTheDocument()
    // Previous goes back with out-of-range handling — first story Previous closes or stays
    // Next then Previous sequence works
    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    expect(await screen.findByRole('heading', { name: 'Morning' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous story' }))
    expect(await screen.findByRole('heading', { name: 'Tip' })).toBeInTheDocument()
  })
})
