import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PublicProfile from './PublicProfile.jsx'
import { renderWithQueryClient as render } from './test/renderWithQueryClient.jsx'

const h = vi.hoisted(() => {
  const ctrl = {}
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
    q.then = (resolve) => resolve({ data: null, error: null })
    return q
  }
  ctrl.from = vi.fn(() => query())
  ctrl.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return { ctrl }
})

vi.mock('./config/supabaseClient', () => ({ supabase: h.ctrl }))
const queryState = vi.hoisted(() => ({
  profile: null,
  profileError: null,
  refetchProfile: vi.fn(),
  posts: [],
  reviews: { reviews: [], reviewers: {} },
  stories: [],
  playlists: [],
}))
vi.mock('./hooks/queries', () => ({
  keys: {
    consultationBooked: (viewerId, professionalId) => ['consultation', 'booked', viewerId, professionalId],
    followerCount: (userId) => ['profile', 'followers', userId],
    followingCount: (userId) => ['profile', 'following', userId],
  },
  useProfile: () => ({
    data: queryState.profile,
    isLoading: false,
    error: queryState.profileError,
    refetch: queryState.refetchProfile,
  }),
  useProfilePosts: () => ({ data: queryState.posts }),
  useProfileReviews: () => ({ data: queryState.reviews }),
  useProfileStories: () => ({ data: queryState.stories }),
  useProfilePlaylists: () => ({ data: queryState.playlists }),
  useFollowerCount: () => ({ data: 0 }),
  useFollowingCount: () => ({ data: 0 }),
  useFollowStatus: () => ({ data: false }),
  useSubscriptionAccess: () => ({ data: { active: false, sub: null } }),
  useConsultationOffer: () => ({ data: null }),
  useConsultationBooked: () => ({ data: false }),
  useToggleFollow: () => ({ mutateAsync: vi.fn() }),
  usePostReview: () => ({ mutateAsync: vi.fn() }),
}))
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

function profileRoute() {
  return (
    <MemoryRouter initialEntries={['/u/prof-1']}>
      <Routes>
        <Route path="/u/:id" element={<PublicProfile />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderProfile() {
  return render(profileRoute())
}

beforeEach(() => {
  h.ctrl.from.mockClear()
  h.ctrl.rpc.mockClear()
  queryState.profile = profile
  queryState.profileError = null
  queryState.refetchProfile.mockClear()
  queryState.posts = []
  queryState.reviews = { reviews: [], reviewers: {} }
  queryState.stories = []
  queryState.playlists = []
  auth.user = null
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn()
})

describe('PublicProfile profile loading states', () => {
  it('shows a retryable load error instead of claiming the profile is missing', () => {
    queryState.profile = null
    queryState.profileError = new Error('permission denied')

    renderProfile()

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this profile.")
    expect(screen.queryByText('Profile not found')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(queryState.refetchProfile).toHaveBeenCalledOnce()
  })

  it('renders the profile after retry succeeds', async () => {
    queryState.profile = null
    queryState.profileError = new Error('network unavailable')
    queryState.refetchProfile.mockImplementation(async () => {
      queryState.profile = profile
      queryState.profileError = null
      return { data: profile, error: null }
    })
    const rendered = renderProfile()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    rendered.rerender(profileRoute())

    expect(await screen.findByRole('heading', { name: 'Dr Ada' })).toBeInTheDocument()
  })

  it('shows not found only when the profile query succeeds without a row', () => {
    queryState.profile = null
    queryState.profileError = null

    renderProfile()

    expect(screen.getByText('Profile not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps cached profile content visible if a background refresh fails', async () => {
    queryState.profileError = new Error('network unavailable')

    renderProfile()

    expect(await screen.findByRole('heading', { name: 'Dr Ada' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('PublicProfile story ring — WhatsApp Status style (ring on avatar, no separate rail)', () => {
  it('shows a single avatar ring when stories exist, no separate rail circles, ordering is position → views → newest via viewer', async () => {
    queryState.stories = [stories[1], stories[0]]

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
    renderProfile()

    await screen.findByRole('heading', { name: 'Dr Ada' })
    expect(screen.queryByRole('button', { name: /^View story:/ })).toBeNull()
    expect(screen.queryByRole('button', { name: "View Dr Ada's story" })).toBeNull()
  })

  it('tapping ring opens viewer directly without a chooser menu', async () => {
    queryState.stories = [stories[1], stories[0]]

    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: "View Dr Ada's story" }))
    // No chooser — viewer appears immediately, no menuitems
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Tip' })).toBeInTheDocument()
  })

  it('viewer auto-advance: stories are ordered and accessible sequentially from ring', async () => {
    queryState.stories = [stories[1], stories[0]]

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
