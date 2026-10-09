// Pins a runtime bug in PublicProfile's subscription flow: confirmSubscribe()
// and handleCancelAutoRenew() called `refreshAccess()`, a helper that no longer
// existed. The ReferenceError fired AFTER subscribe()/cancelAutoRenew() had
// already succeeded (CareCoins charged), so the creator notification and the
// success toast never ran and the subscription state was never refreshed.
// Both handlers must invalidate keys.subscriptionAccess(viewer, creator).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PublicProfile from './PublicProfile.jsx'
import { keys } from './hooks/queries'
import { notify } from './services/notify.js'
import { subscribe, cancelAutoRenew } from './modules/subscriptions-monetization/subscriptions.js'
import { renderWithQueryClient as render } from './test/renderWithQueryClient.jsx'

const state = vi.hoisted(() => ({ user: null, profile: null, subData: { active: false, sub: null } }))

vi.mock('./config/supabaseClient', () => ({ supabase: { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) } }))
// Real `keys` (so the test pins the actual query key shape); hooks are stubbed.
vi.mock('./hooks/queries', async (importOriginal) => {
  const { keys } = await importOriginal()
  const none = () => ({ data: undefined })
  return {
    keys,
    useProfile: () => ({ data: state.profile, isLoading: false, error: null, refetch: vi.fn() }),
    useProfilePosts: none,
    useProfileReviews: none,
    useProfileStories: none,
    useProfilePlaylists: none,
    useFollowerCount: none,
    useFollowingCount: none,
    useFollowStatus: none,
    useSubscriptionAccess: () => ({ data: state.subData }),
    useConsultationOffer: none,
    useConsultationBooked: none,
    useToggleFollow: () => ({ mutate: vi.fn() }),
    usePostReview: () => ({ mutateAsync: vi.fn() }),
  }
})
vi.mock('./providers/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }))
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
  subscribe: vi.fn(),
  checkAccess: vi.fn(async () => ({ active: false, sub: null })),
  cancelAutoRenew: vi.fn(),
  coinsToNaira: vi.fn(() => 0),
}))
vi.mock('./modules/subscriptions-monetization/consultations.js', () => ({
  coinsForConsultation: vi.fn(() => 0),
  fetchConsultationOffer: vi.fn(async () => null),
  hasBookedConsultation: vi.fn(async () => false),
  bookConsultation: vi.fn(async () => ({})),
  bookConsultationWithPaystackFallback: vi.fn(async () => ({})),
  settleConsultationCardPayment: vi.fn(async () => ({ ok: true })),
}))
vi.mock('./modules/social-feed/storyViews.js', () => ({
  fetchViewedStoryIds: vi.fn(async () => new Set()),
  markStoriesViewed: vi.fn(async () => null),
}))

const VIEWER = 'viewer-1'
const CREATOR = 'creator-1'
const accessKey = keys.subscriptionAccess(VIEWER, CREATOR)

function renderProfile() {
  const rendered = render(
    <MemoryRouter initialEntries={[`/u/${CREATOR}`]}>
      <Routes>
        <Route path="/u/:id" element={<PublicProfile />} />
      </Routes>
    </MemoryRouter>,
  )
  return { ...rendered, invalidate: vi.spyOn(rendered.queryClient, 'invalidateQueries') }
}

function giftNotifications() {
  return notify.mock.calls.filter(([n]) => n.type === 'gift')
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  state.user = { id: VIEWER }
  state.profile = {
    id: CREATOR, full_name: 'Dr Ada', display_name: 'ada', is_verified: false,
    verification_label: null, location: null, website: null, avatar_url: null,
    cover_url: null, subscription_price: 50, bio: null, show_followers: true,
  }
  state.subData = { active: false, sub: null }
  subscribe.mockResolvedValue({})
  cancelAutoRenew.mockResolvedValue(undefined)
})

describe('PublicProfile subscribe flow', () => {
  it('refreshes access, notifies the creator and toasts after a successful subscribe', async () => {
    const { invalidate } = renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe ·/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe' }))

    expect(await screen.findByText(/^Subscribed! /)).toBeInTheDocument()
    expect(subscribe).toHaveBeenCalledWith(VIEWER, CREATOR, 50)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKey })
    expect(giftNotifications()).toHaveLength(1)
    expect(giftNotifications()[0][0]).toMatchObject({ recipientId: CREATOR, actorId: VIEWER })
  })

  it('shows an error and neither refreshes nor notifies when subscribe fails', async () => {
    subscribe.mockResolvedValue({ error: 'card declined' })
    const { invalidate } = renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe ·/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe' }))

    expect(await screen.findByText('Could not subscribe: card declined')).toBeInTheDocument()
    expect(screen.queryByText(/^Subscribed! /)).toBeNull()
    expect(invalidate).not.toHaveBeenCalled()
    expect(giftNotifications()).toHaveLength(0)
  })

  it('refreshes access and toasts after turning auto-renew off', async () => {
    state.subData = { active: true, sub: { id: 'sub-1' } }
    const { invalidate } = renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: 'Subscribed' }))

    expect(await screen.findByText(/^Auto-renew turned off/)).toBeInTheDocument()
    expect(cancelAutoRenew).toHaveBeenCalledWith(VIEWER, CREATOR)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKey })
  })
})
