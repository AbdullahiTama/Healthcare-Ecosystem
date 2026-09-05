import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A controllable useAuth: individual tests override the logged-in user via
// mockUseAuth.mockReturnValue(...) (gift/edit/delete all need an owner or a
// viewer, and default-logged-out must not break the read-only tests).
const mockUseAuth = vi.fn(() => ({ user: null }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => mockUseAuth() }))

// usePostEngagement now issues a couple of real reads beyond the post itself:
// `hydrate` resolves repost sources via `supabase.from('posts')...in('id', ids)`,
// and a separate effect resolves the viewer's unlocked creators via
// `supabase.from('creator_subscriptions')...eq('subscriber_id', id)`. Both
// tables are backed by this small controllable registry (constraint-filtered,
// the same way usePostEngagement.test.jsx's own harness works) instead of the
// flat always-empty response every other table gets — everything else in
// PostPage's flow (its own edits/deletes/reports) only cares that the call
// resolves, not what it returns.
const mockTables = vi.hoisted(() => ({ posts: [], creator_subscriptions: [] }))

vi.mock('../../config/supabaseClient', () => {
  function matches(row, cons) {
    return Object.entries(cons).every(([col, vals]) => vals.flat().some((v) => row[col] === v))
  }
  function builder(table) {
    const cons = {}
    const b = {
      select: vi.fn(() => b),
      eq: vi.fn((col, val) => { (cons[col] = cons[col] || []).push(val); return b }),
      in: vi.fn((col, vals) => { (cons[col] = cons[col] || []).push(vals); return b }),
      order: vi.fn(() => b), limit: vi.fn(() => b),
      update: vi.fn(() => b), delete: vi.fn(() => b), insert: vi.fn(() => b),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve) => {
        const rows = (mockTables[table] || []).filter((row) => matches(row, cons))
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return b
  }
  return {
    supabase: {
      from: vi.fn((table) => builder(table)),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    },
  }
})
// Only the data access is stubbed. `isPostMissingError` — which decides
// whether a rejected fetch is a missing post or a failed request — is kept
// real, because a hand-written copy of it in here would pass whatever the
// component does.
vi.mock('./repositories', async (importOriginal) => ({
  ...(await importOriginal()),
  postRepository: { getPostById: vi.fn() },
  commentRepository: {},
}))
vi.mock('./components/CommentThread.jsx', () => ({ CommentThread: () => <div>comments</div> }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
// The real AppShell renders <DesktopHeader/> + <main>{children}</main>; this
// mock keeps that one structural fact (the single <main> landmark PostPage
// relies on for desktop/tablet) without pulling in the header/sidebar chrome.
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <main>{children}</main> }))
vi.mock('../../utils/VisualCard.jsx', () => ({ default: () => <div /> }))
vi.mock('../news-publishing/ArticleEditor.jsx', () => ({ default: () => <div /> }))
// Rendered as plain buttons (not a real dropdown) so the gift/edit/delete/
// report wiring tests can drive them directly — PostPage's job is proven by
// what happens when Edit/Delete/Report fire, not by PostMenu's own popover
// mechanics (which have their own coverage elsewhere).
vi.mock('./PostMenu.jsx', () => ({
  default: ({ items }) => (
    <div>
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onSelect}>{item.label}</button>
      ))}
    </div>
  ),
}))
vi.mock('../subscriptions-monetization/GiftPanel.jsx', () => ({
  default: ({ postId }) => <div>Gift panel open for {postId}</div>,
}))

import PostPage from './PostPage.jsx'
import { postRepository } from './repositories'

function renderAt(id = 'p1') {
  return render(
    <MemoryRouter initialEntries={[`/post/${id}`]}>
      <Routes>
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/feed" element={<div>feed landing</div>} />
      </Routes>
    </MemoryRouter>
  )
}

const post = (overrides = {}) => ({
  id: 'p1', user_id: 'a1', post_type: 'text',
  content: 'The body of a permalinked post.',
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

beforeEach(() => {
  postRepository.getPostById.mockReset()
  mockUseAuth.mockReturnValue({ user: null })
  mockTables.posts = []
  mockTables.creator_subscriptions = []
})

describe('PostPage', () => {
  it('shows a loading state while the post is in flight', () => {
    postRepository.getPostById.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the post body once loaded', async () => {
    postRepository.getPostById.mockResolvedValue(post())
    renderAt()
    expect(await screen.findByText(/body of a permalinked post/i)).toBeInTheDocument()
  })

  it('renders the conversation below the post', async () => {
    postRepository.getPostById.mockResolvedValue(post({ content: 'x' }))
    renderAt()
    // Unlike the plain "post body renders" assertion above, "comments"
    // only appears after a SECOND round trip: the initial load resolves,
    // the post-load effect fires toggleComments(post.id), which itself
    // awaits a `post_comments` select before the (mocked) CommentThread
    // mounts. That extra hop is what lost the race against findByText's
    // default 1000ms timeout in a full-suite run under jsdom contention
    // (320s run vs. the usual ~90-190s) despite passing every time in
    // isolation. The headroom is now global — `configure({ asyncUtilTimeout })`
    // in src/test/setup.js — so this assertion and every other findBy* in the
    // suite gets it, rather than only the two that happened to go red first.
    expect(await screen.findByText('comments')).toBeInTheDocument()
  })

  // The shape supabase-js actually throws from `.single()` when it did not get
  // exactly one row: a PostgREST error carrying the code, not a bare Error
  // whose message happens to read PGRST116. The code is what tells a missing
  // post apart from a failed request (isPostMissingError), so the fixture has
  // to carry it or the distinction is never really exercised.
  const noRowsError = () =>
    Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' })

  it('shows the not-available state when the post is missing', async () => {
    postRepository.getPostById.mockRejectedValue(noRowsError())
    renderAt()
    expect(await screen.findByText(/isn't available/i)).toBeInTheDocument()
  })

  // Fix round 2 (I6): every catch used to set notFound, so a dropped
  // connection told the reader that a post which exists "isn't available" —
  // on the app's primary entry point for shared links, with no way to try
  // again. Design §5 asks for an error state with a retry, and this is it.
  it('a failed request gets its own error state with a retry, not the not-available message', async () => {
    postRepository.getPostById.mockRejectedValue(new TypeError('Failed to fetch'))
    renderAt()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/couldn't load this post/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText(/isn't available/i)).not.toBeInTheDocument()
  })

  it('Retry re-issues the fetch and renders the post once it succeeds', async () => {
    postRepository.getPostById
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(post())
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(/body of a permalinked post/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  // The other side of that split, and the property that must not regress: a
  // post that is gone and a post RLS hides both arrive as the same PGRST116
  // and must stay one indistinguishable message. Telling a reader "something
  // went wrong, try again" for one and "isn't available" for the other would
  // make the permalink an existence oracle.
  it('a missing post is not offered a retry, and reads the same as a hidden one', async () => {
    postRepository.getPostById.mockRejectedValue(noRowsError())
    renderAt()

    await screen.findByText(/isn't available/i)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn't load this post/i)).not.toBeInTheDocument()
  })

  it('does not distinguish a deleted post from a hidden one', async () => {
    postRepository.getPostById.mockResolvedValue(null)
    renderAt()
    const msg = await screen.findByText(/isn't available/i)
    expect(msg.textContent).not.toMatch(/deleted|private|permission|denied/i)
  })

  it('exposes one h1 and a main landmark', async () => {
    postRepository.getPostById.mockResolvedValue(post({ content: 'x' }))
    renderAt()
    await screen.findByRole('main')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  // The three the brief would have shipped inert (addendum §6): PostCard
  // renders Gift for every viewer and Edit/Delete for the author regardless
  // of whether PostPage actually wires them, so only exercising the real
  // controls proves these aren't dead buttons on a permalink.
  it('pressing Gift on a loaded post opens the gift panel', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u2' } })
    postRepository.getPostById.mockResolvedValue(post())
    renderAt()
    await screen.findByText(/body of a permalinked post/i)

    fireEvent.click(screen.getByRole('button', { name: /send a gift/i }))
    expect(await screen.findByText(/gift panel open for p1/i)).toBeInTheDocument()
  })

  it('a successful edit closes the editor and shows the new body', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'a1' } })
    postRepository.getPostById
      .mockResolvedValueOnce(post({ content: 'Original body' }))
      .mockResolvedValueOnce(post({ content: 'Updated body' }))
    renderAt()
    await screen.findByText('Original body')

    fireEvent.click(screen.getByRole('button', { name: 'Edit post' }))
    expect(await screen.findByRole('textbox', { name: 'Edit post' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Same pattern as "renders the conversation below the post": the save
    // triggers reloadFeed() -> refetchThisPost(), a second full
    // getPostById + hydrate round trip, not just a local state flip. The
    // global asyncUtilTimeout (src/test/setup.js) is what keeps it from
    // losing that race under full-suite contention.
    expect(await screen.findByText('Updated body')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Edit post' })).not.toBeInTheDocument()
  })

  it('confirming delete calls through and navigates to /feed', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'a1' } })
    postRepository.getPostById.mockResolvedValue(post())
    renderAt()
    await screen.findByText(/body of a permalinked post/i)

    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('feed landing')).toBeInTheDocument()
  })

  // Fix round 1: a permalink to a repost used to fall through to "This post
  // is no longer available" — resolveSource(post.repost_of) only ever found
  // anything when Feed's own effect had populated repostSources, which never
  // ran on PostPage. usePostEngagement.hydrate now resolves it directly.
  it('a permalink to a repost renders the source post body, not the unavailable state', async () => {
    mockTables.posts = [
      {
        id: 'src1', user_id: 'a9', post_type: 'text',
        content: 'The original words, written by someone else.',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    postRepository.getPostById.mockResolvedValue({
      id: 'r1', user_id: 'u1', post_type: 'text', content: '🔁',
      repost_of: 'src1', created_at: '2026-01-02T00:00:00.000Z',
    })
    renderAt('r1')

    expect(await screen.findByText(/the original words, written by someone else/i)).toBeInTheDocument()
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument()
  })

  // Fix round 1 (C1): unlockedCreators used to be permanently empty on
  // PostPage (only Feed's loadUnlocked ever populated it), so a subscriber
  // hit the paywall for content they had already paid for. The hook now
  // resolves it itself via a `user`-keyed effect.
  it('renders a subscriber-only post body when the viewer has an active subscription to its author', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' } })
    mockTables.creator_subscriptions = [
      { creator_id: 'a1', subscriber_id: 'u1', expires_at: '2099-01-01T00:00:00.000Z' },
    ]
    postRepository.getPostById.mockResolvedValue(post({ subscriber_only: true, content: 'Subscriber-only body.' }))
    renderAt()

    expect(await screen.findByText('Subscriber-only body.')).toBeInTheDocument()
    expect(screen.queryByText(/subscriber-only content/i)).not.toBeInTheDocument()
  })

  it('shows the paywall for a subscriber-only post when the viewer has no active subscription', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' } })
    mockTables.creator_subscriptions = []
    postRepository.getPostById.mockResolvedValue(post({ subscriber_only: true, content: 'Subscriber-only body.' }))
    renderAt()

    // The teaser deliberately shows an opening snippet of the body above the
    // gate (PostCard.jsx), so the real locked/unlocked signal is the gate
    // itself — its "Subscribe to..." CTA only renders while still locked.
    expect(await screen.findByText(/subscriber-only content/i)).toBeInTheDocument()
    expect(screen.getByText(/subscribe to .* to read the rest/i)).toBeInTheDocument()
  })
})
