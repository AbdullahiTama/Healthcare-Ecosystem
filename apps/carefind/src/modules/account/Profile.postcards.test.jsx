import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Issues #3/#4 regression suite. A profile used to render posts through
// PostTileGrid — a bare tile grid with no interactions and no way to manage
// your own posts. Every surface now renders the same full-featured PostCard,
// driven by the same engagement layer the feed uses. These tests fail red on
// the old tile-grid code: tiles had no Like/Share/Gift buttons and no
// Edit/Delete overflow menu.

const mockSupabase = vi.hoisted(() => {
  const tables = {}
  // Any builder method (eq/gt/in/order/…) chains and stays awaitable.
  const makeQuery = (table) => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve({ data: tables[table] || [], error: null })
      if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: null, error: null })
      return () => makeQuery(table)
    },
  })
  return {
    tables,
    from: vi.fn((table) => makeQuery(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }
})

// A STABLE user identity: Profile's load effect keys on [user], so a fresh
// object per render would re-enter setLoading(true) forever and unmount the
// content under test.
const { authUser } = vi.hoisted(() => ({ authUser: { id: 'user-1', email: 'me@carefind.app' } }))
vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../providers/AuthContext', () => ({
  useAuth: () => ({ user: authUser, signOut: vi.fn() }),
}))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({
  useHeaderIdentity: () => ({ myUsername: 'me', myAvatar: null, unreadNotifs: 0 }),
}))
vi.mock('../subscriptions-monetization/subscriptions.js', () => ({
  MAX_PRICE_COINS: 100000,
  coinsToNaira: () => 0,
  loadActiveCreatorIds: async () => [],
}))
// Heavy children that have nothing to do with what these tests assert.
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('./ProductUpload.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/FollowersSheet.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/components/StoryViewer.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/Stories.jsx', () => ({ default: () => null }))

import Profile from './Profile.jsx'

const MY_POST = {
  id: 'p1',
  user_id: 'user-1',
  content: 'A post I wrote myself about wound care.',
  post_type: 'text',
  created_at: new Date().toISOString(),
  repost_of: null,
  repost_count: 0,
  view_count: 0,
  subscriber_only: false,
  is_premium: false,
  image_url: null,
  video_url: null,
  audio_url: null,
  rating: null,
}

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  )
}

describe('Profile renders full-featured PostCards (issues #3/#4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The Posts tab list comes from the `posts` table; every other read is
    // incidental setup and resolves empty.
    Object.keys(mockSupabase.tables).forEach((k) => delete mockSupabase.tables[k])
    mockSupabase.tables.posts = [MY_POST]
    mockSupabase.tables.saved_posts = []
  })

  it('offers the feed interactions on a profile post: like, share, gift, save', async () => {
    renderProfile()
    const hit = await Promise.race([
      screen.findByText(/wound care/i).then(() => 'card'),
      screen.findByText('You have not posted yet.').then(() => 'empty'),
    ]).catch(() => 'neither')
    expect(hit).toBe('card')
    expect(screen.getByRole('button', { name: /like this post/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share this post/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send a gift/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save this post/i })).toBeInTheDocument()
  })

  it('gives the creator manage options (Edit/Delete) on their own post', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /options for .+/i }))
    // PostMenu items carry an explicit menuitem role.
    expect(screen.getByRole('menuitem', { name: /^edit post$/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^delete post$/i })).toBeInTheDocument()
  })

  it('opens comments inline from the profile card', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /comments on .+/i }))
    expect(await screen.findByPlaceholderText('Add a comment')).toBeInTheDocument()
  })
})
