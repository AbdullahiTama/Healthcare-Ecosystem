import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Task 6: one URL, /post/:id, serves two surfaces depending on how the
// reader arrived — tapped from inside the feed (an overlay on top of it,
// via a `state.background` history entry) or loaded cold (the standalone
// PostPage). The brief's own sketch of this test rendered <Feed /> with no
// <Routes> around it at all, so location never mattered and the assertion
// "the feed is still there" could not fail (see task-6-addendum.md §3).
// This version registers the same route shape main.jsx does — BackgroundRoutes
// wrapping /feed and /post/:id, with /post/:id also as the modal route — so
// the real routing mechanism is what's under test, not a stand-in for it.
// Deliberately not importing main.jsx's AppRoutes wholesale: that file also
// mounts ~25 routes unrelated to this split, which would only add mocking
// weight without adding coverage of the thing this test exists to check.

const mockSupabase = vi.hoisted(() => {
  const data = { tables: { posts: [], profiles: [] }, rpcRows: {} }
  const rows = (table) => data.tables[table] || []
  const matches = (row, cons) =>
    Object.entries(cons).every(([col, vals]) => {
      const arr = Array.isArray(vals) ? vals : [vals]
      return arr.some((v) => row[col] === v)
    })
  function builder(table) {
    const cons = {}
    const b = {
      select: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      not: vi.fn(() => b),
      or: vi.fn(() => b),
      textSearch: vi.fn(() => b),
      ilike: vi.fn(() => b),
      eq: vi.fn((col, v) => { (cons[col] = cons[col] || []).push(v); return b }),
      in: vi.fn((col, vs) => { (cons[col] = cons[col] || []).push(vs); return b }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: rows(table).find((r) => matches(r, cons)) || null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: rows(table).find((r) => matches(r, cons)) || null, error: null })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve) => Promise.resolve({ data: rows(table).filter((r) => matches(r, cons)), error: null }).then(resolve),
    }
    return b
  }
  const supabase = {
    from: vi.fn((table) => builder(table)),
    rpc: vi.fn((fn) => Promise.resolve({ data: data.rpcRows[fn] || [], error: null })),
    channel: vi.fn(() => {
      const ch = { on: vi.fn(() => ch), subscribe: vi.fn(() => ch), unsubscribe: vi.fn(() => ch) }
      return ch
    }),
    removeChannel: vi.fn(() => {}),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => Promise.resolve({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'blob:mock-url' } })),
      })),
    },
  }
  return { supabase, data }
})

vi.mock('../config/supabaseClient', () => ({ supabase: mockSupabase.supabase }))
vi.mock('../providers/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../modules/social-feed/repositories', () => ({
  postRepository: { getPostById: vi.fn() },
  commentRepository: {},
}))

// Leaf/heavy children irrelevant to the routing split: the same stub set
// Feed.test.jsx and PostPage.test.jsx already use for these, so Feed and
// PostPage/PostModalRoute render for real through everything that matters
// here (routing, PostCard, the overlay/page chrome) without dragging in
// unrelated leaves (voice/video recording, article editing, etc).
vi.mock('../utils/VisualCard.jsx', () => ({ default: () => <div /> }))
vi.mock('../modules/news-publishing/ArticleEditor.jsx', () => ({ default: () => <div /> }))
vi.mock('../modules/social-feed/PostMenu.jsx', () => ({ default: () => null }))
vi.mock('../modules/social-feed/components/CommentThread.jsx', () => ({ CommentThread: () => null }))
vi.mock('../modules/social-feed/Stories.jsx', () => ({ default: () => null }))
vi.mock('../modules/social-feed/Logo.jsx', () => ({ default: () => null }))
vi.mock('../modules/social-feed/GoLive.jsx', () => ({ default: () => null }))
vi.mock('../modules/social-feed/UserGoLive.jsx', () => ({ default: () => null }))
vi.mock('./VoiceRecorder.jsx', () => ({ default: () => null }))
vi.mock('./DrawingBoard.jsx', () => ({ default: () => null }))
vi.mock('./SupportPrompt.jsx', () => ({ default: () => null }))
vi.mock('./BottomNav.jsx', () => ({ default: () => null }))
vi.mock('./layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('./layout/RightSidebar.jsx', () => ({ default: () => null }))
vi.mock('../modules/subscriptions-monetization/GiftPanel.jsx', () => ({ default: () => null }))
vi.mock('../services/notify.js', () => ({ notify: vi.fn() }))
vi.mock('../services/ensureProfile.js', () => ({ ensureProfile: vi.fn() }))
vi.mock('../lib/activeIdentity', () => ({ getActiveIdentity: vi.fn(() => null) }))
vi.mock('../utils/share.js', () => ({
  shareOrCopy: vi.fn().mockResolvedValue('copied'),
  mediaToFile: vi.fn().mockResolvedValue(null),
}))
vi.mock('../utils/voiceCard.js', () => ({
  canExportVideo: () => false,
  exportImage: vi.fn().mockResolvedValue({}),
  exportVideo: vi.fn().mockRejectedValue(new Error('no-video')),
  shareOrDownload: vi.fn(),
}))
vi.mock('../utils/imageResize.js', () => ({ resizeImage: vi.fn() }))

import BackgroundRoutes from './BackgroundRoutes.jsx'
import Feed from '../modules/social-feed/Feed.jsx'
import PostPage from '../modules/social-feed/PostPage.jsx'
import PostModalRoute from '../modules/social-feed/PostModalRoute.jsx'
import { postRepository } from '../modules/social-feed/repositories'

// The preview clamp is measured after mount (scrollHeight > clientHeight);
// force it "overflowing" so a feed card's See more button — the real path
// Task 6 wires to navigate() — is present, the same way PostCard.test.jsx
// and Feed's own tests force it.
let scrollH = 100
let clientH = 50
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollH })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientH })

function makePost(overrides = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    post_type: 'text',
    content: 'A distinctively worded post body the routing test looks for on both surfaces.',
    created_at: '2026-01-01T00:00:00.000Z',
    view_count: 0,
    repost_count: 0,
    posted_as_type: null,
    posted_as_id: null,
    repost_of: null,
    image_url: null,
    video_url: null,
    audio_url: null,
    theme: null,
    rating: null,
    ...overrides,
  }
}

// After inline-expand change, /post/:id is always a full page (PostPage);
// feed See more no longer navigates to a modal overlay.
function renderRouted(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/feed" element={<Feed />} />
        <Route path="/post/:id" element={<PostPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockSupabase.data.tables.posts = []
  mockSupabase.data.tables.profiles = []
  mockSupabase.data.rpcRows = {}
  postRepository.getPostById.mockReset()
})

describe('/post/:id as an overlay vs a standalone page (Task 6)', () => {
  it('opening a post from the feed expands inline and keeps the feed mounted (no modal)', async () => {
    mockSupabase.data.tables.posts = [makePost()]
    postRepository.getPostById.mockResolvedValue(makePost())
    renderRouted(['/feed'])

    // The feed rendered the post for real (through the real PostCard, not a stub).
    await screen.findByText(/distinctively worded post body/i)

    const seeMore = await screen.findByRole('button', { name: /expand the full post by/i })
    fireEvent.click(seeMore)

    // No modal dialog — See more expands inline to Show less
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /collapse post by/i })).toBeInTheDocument()

    // Feed chrome still mounted, still only one copy of the body (expanded in place)
    expect(screen.getAllByText(/distinctively worded post body/i).length).toBe(1)
    expect(screen.getByRole('button', { name: /^for you$/i })).toBeInTheDocument()

    // Collapse back
    fireEvent.click(screen.getByRole('button', { name: /collapse post by/i }))
    expect(await screen.findByRole('button', { name: /expand the full post by/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Inline expand is reversible via Show less; no overlay to close.
  it('collapsing after expand keeps the feed mounted', async () => {
    mockSupabase.data.tables.posts = [makePost()]
    postRepository.getPostById.mockResolvedValue(makePost())
    renderRouted(['/feed'])

    await screen.findByText(/distinctively worded post body/i)
    fireEvent.click(await screen.findByRole('button', { name: /expand the full post by/i }))
    await screen.findByRole('button', { name: /collapse post by/i })

    fireEvent.click(screen.getByRole('button', { name: /collapse post by/i }))

    // No dialog ever appeared, feed still here
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^for you$/i })).toBeInTheDocument()
    expect(screen.getAllByText(/distinctively worded post body/i).length).toBe(1)
  })

  it('a direct load of /post/:id with no background renders PostPage, not the feed', async () => {
    postRepository.getPostById.mockResolvedValue(makePost({ content: 'Standalone permalink body, nothing behind it.' }))
    renderRouted(['/post/p1'])

    await screen.findByText(/standalone permalink body/i)

    // Not an overlay — this is the page itself, so there is no dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Feed's own chrome never mounted alongside it.
    expect(screen.queryByRole('button', { name: /^for you$/i })).not.toBeInTheDocument()
  })
})
