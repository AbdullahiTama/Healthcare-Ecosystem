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

describe('PublicProfile story rail (Feature 4)', () => {
  it('renders one circle per story, ordered position → views → newest', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null }) // posts
    h.ctrl.push({ count: 0, error: null }) // follows (following_id)
    h.ctrl.push({ count: 0, error: null }) // follows (follower_id)
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null }) // playlists
    h.ctrl.push({ data: [], error: null }) // user_reviews

    renderProfile()

    const railButtons = await screen.findAllByRole('button', { name: /^View story/ })
    expect(railButtons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'View story: Tip',
      'View story: Morning',
    ])
  })

  it('renders no rail (and no ring button) when the profile has no stories', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: [], error: null }) // no stories
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    await screen.findByRole('heading', { name: 'Dr Ada' })
    expect(screen.queryByRole('button', { name: /^View story/ })).toBeNull()
    expect(screen.queryByRole('button', { name: "View Dr Ada's story" })).toBeNull()
  })

  it('tapping a rail circle opens the viewer at that story index', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    fireEvent.click((await screen.findAllByRole('button', { name: /^View story/ }))[1])
    expect(screen.getByRole('heading', { name: 'Morning' })).toBeInTheDocument()
  })
})

describe('PublicProfile story chooser (Feature 4 / 5)', () => {
  it('opens a chooser on ring tap offering View Stories and View Profile', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: "View Dr Ada's story" }))
    expect(screen.getByRole('menuitem', { name: 'View Stories' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View Profile' })).toBeInTheDocument()
  })

  it('View Stories starts the viewer from the first story', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: "View Dr Ada's story" }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Stories' }))
    expect(screen.getByRole('heading', { name: 'Tip' })).toBeInTheDocument()
  })

  it('View Profile dismisses the chooser without opening the viewer', async () => {
    h.ctrl.push({ data: profile, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ count: 0, error: null })
    h.ctrl.push({ data: stories, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: "View Dr Ada's story" }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'View Profile' }))
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Tip' })).toBeNull()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})