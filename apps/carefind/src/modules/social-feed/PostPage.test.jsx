import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A controllable useAuth: individual tests override the logged-in user via
// mockUseAuth.mockReturnValue(...) (gift/edit/delete all need an owner or a
// viewer, and default-logged-out must not break the read-only tests).
const mockUseAuth = vi.fn(() => ({ user: null }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => mockUseAuth() }))

// A builder that supports the read AND write chains PostPage's hooks issue
// (select/update/delete/insert), always settling empty/no-op so hydrate()
// never throws. Individual tests only care that the calls resolve, not what
// they return — postRepository.getPostById (mocked separately below) is
// what actually drives what's on screen.
vi.mock('../../config/supabaseClient', () => {
  function builder() {
    const b = {
      select: vi.fn(() => b), eq: vi.fn(() => b), in: vi.fn(() => b),
      order: vi.fn(() => b), limit: vi.fn(() => b),
      update: vi.fn(() => b), delete: vi.fn(() => b), insert: vi.fn(() => b),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return b
  }
  return {
    supabase: {
      from: vi.fn(() => builder()),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    },
  }
})
vi.mock('./repositories', () => ({ postRepository: { getPostById: vi.fn() }, commentRepository: {} }))
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
    expect(await screen.findByText('comments')).toBeInTheDocument()
  })

  it('shows the not-available state when the post is missing', async () => {
    postRepository.getPostById.mockRejectedValue(new Error('PGRST116'))
    renderAt()
    expect(await screen.findByText(/isn't available/i)).toBeInTheDocument()
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
})
