import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../test/renderWithQueryClient.jsx'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'

// Minimal fake Supabase: every builder method is a thenable that resolves to
// the table's rows filtered by the eq/in constraints accumulated so far.
const mockSupabase = vi.hoisted(() => {
  const data = {
    tables: {
      posts: [], post_reactions: [], post_reposts: [], profiles: [],
      post_comments: [], post_shares: [], saved_posts: [], follows: [],
      user_subscriptions: [], businesses: [], feed_ranking_config: [],
      candidate_generation_pools: [], content_distribution_experiments: [],
      news: [], live_sessions: [], live_shows: [], playlists: [], feed_config: [],
    },
    rpcRows: {},
    // table -> true makes every plain read of that table resolve with an error
    errors: {},
  }
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
      then: (resolve) => Promise.resolve(
        data.errors[table]
          ? { data: null, error: { message: `permission denied for ${table}` } }
          : { data: rows(table).filter((r) => matches(r, cons)), error: null }
      ).then(resolve),
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

vi.mock('../../config/supabaseClient', () => ({
  supabase: mockSupabase.supabase,
}))
vi.mock('../../providers/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

// Leaf/heavy children: not exercised by these tests.
vi.mock('../../utils/VisualCard.jsx', () => ({ default: () => <div /> }))
vi.mock('../news-publishing/ArticleEditor.jsx', () => ({ default: () => <div /> }))
vi.mock('./PostMenu.jsx', () => ({ default: () => null }))
vi.mock('./components/CommentThread.jsx', () => ({ CommentThread: () => null }))
vi.mock('./Stories.jsx', () => ({ default: () => null }))
vi.mock('./Logo.jsx', () => ({ default: () => null }))
vi.mock('./GoLive.jsx', () => ({ default: () => null }))
vi.mock('./UserGoLive.jsx', () => ({ default: () => null }))
vi.mock('../../components/VoiceRecorder.jsx', () => ({ default: () => null }))
vi.mock('../../components/DrawingBoard.jsx', () => ({ default: () => null }))
vi.mock('../../components/SupportPrompt.jsx', () => ({ default: () => null }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('../../components/layout/AppShell.jsx', () => ({
  default: ({ children }) => <div>{children}</div>,
}))
vi.mock('../../components/layout/RightSidebar.jsx', () => ({ default: () => null }))
vi.mock('../subscriptions-monetization/GiftPanel.jsx', () => ({ default: () => null }))

vi.mock('../../services/notify.js', () => ({ notify: vi.fn() }))
vi.mock('../../services/ensureProfile.js', () => ({ ensureProfile: vi.fn() }))
vi.mock('../../lib/activeIdentity', () => ({ getActiveIdentity: vi.fn(() => null) }))
vi.mock('../../utils/share.js', () => ({
  shareOrCopy: vi.fn().mockResolvedValue('copied'),
  mediaToFile: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../utils/voiceCard.js', () => ({
  canExportVideo: () => false,
  exportImage: vi.fn().mockResolvedValue({}),
  exportVideo: vi.fn().mockRejectedValue(new Error('no-video')),
  shareOrDownload: vi.fn(),
}))
vi.mock('../../utils/imageResize.js', () => ({ resizeImage: vi.fn() }))

import Feed from './Feed.jsx'
import { shareOrCopy } from '../../utils/share.js'
import { POSTS_DIRTY_EVENT } from './postSync.js'

function makePost(overrides = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    post_type: 'text',
    content: 'A shareable post body used across the feed tests.',
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

function renderFeed(initialPath = '/feed') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Feed />
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockSupabase.data.tables.posts = []
  mockSupabase.data.tables.profiles = []
  mockSupabase.data.rpcRows = {}
  mockSupabase.data.errors = {}
  shareOrCopy.mockClear()
})

// Task 6: opening a post ("See more" or a shared link) is no longer Feed's
// own modal machinery — it is a navigation to the post's permalink
// (/post/:id), with the current feed location carried as history state so
// BackgroundRoutes can render it as an overlay on top of this page instead
// of replacing it. That combination (Feed's navigate call + BackgroundRoutes
// + PostModalRoute) is exercised end-to-end in
// src/components/BackgroundRoutes.test.jsx; sharePost's own URL shape is
// covered here. Task 7 moved that shape itself from /feed?post=<id> to the
// post's own permalink, /post/<id> — this pins the new contract.
describe('Feed share URL', () => {
  it('shares a post with a /post/<id> URL', async () => {
    mockSupabase.data.tables.posts = [makePost()]
    renderFeed('/feed')

    const share = await screen.findByRole('button', { name: /share this post/i })
    fireEvent.click(share)

    await waitFor(() => expect(shareOrCopy).toHaveBeenCalled())
    const arg = shareOrCopy.mock.calls[0][0]
    const url = new URL(arg.url)
    expect(url.pathname).toBe('/post/p1')
  })
})

// Task 7: Task 6 deleted Feed's ?post= handling along with its modal
// machinery, so every URL already shared publicly and every
// notifications.link row already written — all in the legacy
// /feed?post=<id> shape — pointed at nothing on this branch until the
// redirect below landed. Rendering a bare <Feed /> can't prove the redirect
// works (there is nowhere for it to land), so this registers the same two
// routes main.jsx does and asserts the old URL actually reaches the new one.
describe('legacy ?post= links', () => {
  it('redirects an old share URL to the permalink', async () => {
    mockSupabase.data.tables.posts = [makePost({ id: 'p1' })]
    render(
      <MemoryRouter initialEntries={['/feed?post=p1']}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
          <Route path="/post/:id" element={<div>permalink page</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('permalink page')).toBeInTheDocument()
  })
})

// Task 6's addendum gave PostModalRoute its own usePostEngagement instance,
// so a mutation made inside the /post/:id overlay never touches this Feed's
// copy of the same post. postSync.js bridges that gap: the overlay dispatches
// POSTS_DIRTY_EVENT on window when it closes dirty, and Feed is supposed to
// answer by reloading (see the listener at Feed.jsx around loadFeedRef).
// These tests exercise the RECEIVING half directly against this real Feed
// instance — dispatching the event and asserting an actual refetch happens —
// rather than trusting a spy on some internal, so they fail if the listener
// is removed, if its effect never attaches, or if the imported event name
// drifts from the one Feed listens for.
describe('postSync: Feed reloads on POSTS_DIRTY_EVENT', () => {
  function postsFetchCount() {
    return mockSupabase.supabase.from.mock.calls.filter((call) => call[0] === 'posts').length
  }

  it('refetches posts when the overlay dispatches POSTS_DIRTY_EVENT', async () => {
    mockSupabase.data.tables.posts = [makePost()]
    renderFeed('/feed')
    await screen.findByText(/A shareable post body/i)

    const before = postsFetchCount()

    window.dispatchEvent(new Event(POSTS_DIRTY_EVENT))

    await waitFor(() => expect(postsFetchCount()).toBeGreaterThan(before))
  })

  it('does not refetch posts when no dirty event fires', async () => {
    mockSupabase.data.tables.posts = [makePost()]
    renderFeed('/feed')
    await screen.findByText(/A shareable post body/i)

    const before = postsFetchCount()

    // Nothing dispatches POSTS_DIRTY_EVENT here — give any stray async work a
    // tick, then confirm no extra 'posts' query was issued.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(postsFetchCount()).toBe(before)
  })
})

// main.jsx keys <Routes> on location.key, so ANY router navigation — a
// `replace` included — remounts the page. Feed's landing params (?create=1,
// ?tab=video) used to be stripped with setSearchParams, which remounted it
// straight after it had consumed them and threw the result away. A bare
// <Feed /> (as in renderFeed) cannot reproduce a remount, so these mirror
// main.jsx's keyed Routes.
function KeyedRoutes() {
  const location = useLocation()
  return (
    <Routes key={location.key}>
      <Route path="/feed" element={<Feed />} />
      <Route path="/post/:id" element={<div>permalink page</div>} />
    </Routes>
  )
}

function renderKeyed(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <KeyedRoutes />
    </MemoryRouter>
  )
}

describe('?create=1 opens the create selector (issue #2)', () => {
  it('opens the selector and keeps it open once the flag is consumed', async () => {
    renderKeyed('/feed?create=1')

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Create')
    expect(screen.getByRole('button', { name: 'Question' })).toBeInTheDocument()

    // Survives past the effect that strips ?create=1 from the URL.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(window.location.search).not.toContain('create=1')
  })
})

describe('?tab= landing param (bottom-nav Videos entry)', () => {
  it('lands on the requested tab and stays there once the param is consumed', async () => {
    renderKeyed('/feed?tab=video')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Videos' })).toHaveAttribute('aria-pressed', 'true'))

    // Survives past the effect that strips ?tab= from the URL — a remount
    // would put it back on "For you".
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('button', { name: 'Videos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'For you' })).toHaveAttribute('aria-pressed', 'false')
    expect(window.location.search).not.toContain('tab=')
  })

  it('keeps ?tab=video&post=<id> on the feed instead of bouncing to the permalink', async () => {
    renderKeyed('/feed?tab=video&post=p1')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Videos' })).toHaveAttribute('aria-pressed', 'true'))

    // Once the tab param is gone a remounted feed would see a bare ?post= and
    // redirect to /post/p1 — the video deep link would never stay on the feed.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('permalink page')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Videos' })).toHaveAttribute('aria-pressed', 'true')
  })
})

// loadEngineConfig used to run its five reads in one try/catch, so one failing
// read skipped everything after it. For a logged-out visitor the businesses
// read (the Medical tab's facility list) failed and the experiment lookup that
// comes after it was never made.
describe('feed engine config degrades step by step', () => {
  it('still looks up experiments when the businesses read fails', async () => {
    mockSupabase.data.errors = { businesses: true }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderFeed('/feed')

    await waitFor(() =>
      expect(mockSupabase.supabase.from.mock.calls.some((call) => call[0] === 'content_distribution_experiments')).toBe(true))

    // The failure is still reported, labelled with the step that failed.
    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes('medical context'))).toBe(true)
    errorSpy.mockRestore()
  })
})
