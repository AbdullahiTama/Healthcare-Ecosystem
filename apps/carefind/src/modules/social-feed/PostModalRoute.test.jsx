import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// PostModalRoute is PostPage's overlay sibling (see BackgroundRoutes.jsx):
// same post, same usePostEngagement wiring, mounted as a Modal above the feed
// instead of at its own page. Mocking approach mirrors PostPage.test.jsx
// exactly so the two suites stay easy to compare.

const mockUseAuth = vi.fn(() => ({ user: null }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => mockUseAuth() }))

// See PostPage.test.jsx for why these two tables get a constraint-filtered
// registry instead of the flat always-empty response every other table gets:
// `hydrate` resolves repost sources from `posts` and the viewer's unlocked
// creators from `creator_subscriptions`. Nothing PostModalRoute-specific
// touches either table in these tests, but the hook runs the same hydrate
// path here as it does on PostPage, so the same shape keeps it from throwing.
const mockTables = vi.hoisted(() => ({ posts: [], creator_subscriptions: [] }))

vi.mock('../../config/supabaseClient', () => {
  function matches(row, cons) {
    return Object.entries(cons).every(([col, vals]) => vals.flat().some((v) => row[col] === v))
  }
  function builder(table) {
    const cons = {}
    // Unlike the flat "always null" response most tables get, an insert
    // echoes back the row it was given (with a generated id) so a real write
    // (toggleLike/toggleSave's insertRowResolvingConflict, which does
    // `.insert(row).select().maybeSingle()`) gets a real row back instead of
    // null — swapping the optimistic temp row for a null one is what a flat
    // mock does, and it crashes PostCard's userHasLiked on the very next
    // render (reactions array ends up with a null entry).
    let insertedRow = null
    const b = {
      select: vi.fn(() => b),
      eq: vi.fn((col, val) => { (cons[col] = cons[col] || []).push(val); return b }),
      in: vi.fn((col, vals) => { (cons[col] = cons[col] || []).push(vals); return b }),
      order: vi.fn(() => b), limit: vi.fn(() => b),
      update: vi.fn(() => b), delete: vi.fn(() => b),
      insert: vi.fn((row) => { insertedRow = { id: `ins_${table}`, ...row }; return b }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: insertedRow, error: null })),
      single: vi.fn(() => Promise.resolve({ data: insertedRow, error: null })),
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
vi.mock('./repositories', () => ({ postRepository: { getPostById: vi.fn() }, commentRepository: {} }))
vi.mock('./components/CommentThread.jsx', () => ({ CommentThread: () => <div>comments</div> }))
vi.mock('../../utils/VisualCard.jsx', () => ({ default: () => <div /> }))
vi.mock('../news-publishing/ArticleEditor.jsx', () => ({ default: () => <div /> }))
// Rendered as plain buttons (not a real dropdown) so the edit/delete/report
// wiring can be driven directly, same as PostPage.test.jsx.
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

import PostModalRoute from './PostModalRoute.jsx'
import { postRepository } from './repositories'
import { supabase } from '../../config/supabaseClient'
import { POSTS_DIRTY_EVENT } from './postSync.js'

// Renders PostModalRoute as BackgroundRoutes actually mounts it: matched
// against the real URL, with a PRIOR history entry to pop back to. `from` is
// deliberately not `/feed` — close() must be `navigate(-1)` (pop back to
// wherever the reader actually came from), not a hardcoded redirect, and a
// route/label pair that isn't `/feed` is what would catch that regression.
function renderAt(id = 'p1', { from = '/notifications', fromLabel = 'a location behind the overlay' } = {}) {
  return render(
    <MemoryRouter initialEntries={[from, `/post/${id}`]} initialIndex={1}>
      <Routes>
        <Route path={from} element={<div>{fromLabel}</div>} />
        <Route path="/post/:id" element={<PostModalRoute />} />
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
  supabase.from.mockClear()
  mockUseAuth.mockReturnValue({ user: null })
  mockTables.posts = []
  mockTables.creator_subscriptions = []
})

describe('PostModalRoute', () => {
  it('shows a loading state while the post is in flight', () => {
    postRepository.getPostById.mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the post body once loaded', async () => {
    postRepository.getPostById.mockResolvedValue(post())
    renderAt()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/body of a permalinked post/i)).toBeInTheDocument()
  })

  // getPostById's two "not available" shapes (see repositories.js: .single()
  // throws PGRST116 on no rows; a plain miss elsewhere can also resolve to
  // null) both have to land on the same message, rendered through
  // PostDetailModal's `error` prop (an ErrorState, role="alert") rather than
  // silently leaving the modal on its loading state forever.
  it('renders the not-found alert when getPostById resolves with no post', async () => {
    postRepository.getPostById.mockResolvedValue(null)
    renderAt()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/isn't available/i)).toBeInTheDocument()
  })

  it('renders the same not-found alert when getPostById throws (RLS-hidden or deleted)', async () => {
    postRepository.getPostById.mockRejectedValue(new Error('PGRST116'))
    renderAt()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/isn't available/i)).toBeInTheDocument()
  })

  it('does not distinguish a deleted post from a hidden one', async () => {
    postRepository.getPostById.mockResolvedValue(null)
    renderAt()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/deleted|private|permission|denied/i)
  })

  // The mechanism the whole overlay design rests on (see BackgroundRoutes.jsx
  // and PostModalRoute.jsx's file comment): closing pops the history entry
  // that carried state.background, revealing whatever was mounted underneath.
  // Nothing else in this suite exercised it before this test existed.
  it('closing the overlay calls navigate(-1), returning to whatever was behind it', async () => {
    postRepository.getPostById.mockResolvedValue(post())
    renderAt()
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(await screen.findByText('a location behind the overlay')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Unlike PostPage (whose delete aftermath is navigate('/feed') — there is
  // no page underneath it to reveal), the overlay's delete aftermath is
  // `close`: pop back to whatever the reader had open, not a hardcoded
  // redirect to the feed.
  it('confirming delete calls through and then closes (not a hardcoded /feed redirect)', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'a1' } })
    postRepository.getPostById.mockResolvedValue(post())
    renderAt('p1', { from: '/saved', fromLabel: 'the saved-posts screen' })
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('the saved-posts screen')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(supabase.from).toHaveBeenCalledWith('posts')
  })

  // postSync.js: the overlay owns its own usePostEngagement instance, so a
  // mutation made in here never reaches Feed's copy of the same post. On
  // close, a dirty overlay dispatches POSTS_DIRTY_EVENT so Feed knows to
  // reload; a clean one (nothing mutated) must stay silent so Feed doesn't
  // reload for no reason on every single overlay open/close.
  it('a mutation in the overlay followed by closing dispatches the dirty event for Feed to reload', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u2' } })
    postRepository.getPostById.mockResolvedValue(post())
    const onDirty = vi.fn()
    window.addEventListener(POSTS_DIRTY_EVENT, onDirty)
    try {
      renderAt()
      await screen.findByRole('dialog')

      fireEvent.click(screen.getByRole('button', { name: 'Like this post' }))
      await screen.findByRole('button', { name: 'Unlike this post' })

      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(onDirty).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(POSTS_DIRTY_EVENT, onDirty)
    }
  })

  it('closing with no mutation does not dispatch the dirty event', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u2' } })
    postRepository.getPostById.mockResolvedValue(post())
    const onDirty = vi.fn()
    window.addEventListener(POSTS_DIRTY_EVENT, onDirty)
    try {
      renderAt()
      await screen.findByRole('dialog')

      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(onDirty).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(POSTS_DIRTY_EVENT, onDirty)
    }
  })
})
