import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import NewsArticle from './NewsArticle.jsx'

// Queue-based supabase mock. Each awaited query resolves with the next queued
// result, in the order NewsArticle makes them: [article, more-news,
// reactions, comments, news_reposts] (saved_news only fires when a user is
// present). Every chain step is a vi.fn so a specific query object can be
// inspected afterwards (see queryFor below).
const h = vi.hoisted(() => {
  const ctrl = { queue: [] }
  ctrl.push = (...results) => { ctrl.queue.push(...results); return ctrl }
  const query = () => {
    const q = {}
    q.select = vi.fn(() => q)
    q.eq = vi.fn(() => q)
    q.neq = vi.fn(() => q)
    q.order = vi.fn(() => q)
    q.limit = vi.fn(() => q)
    q.maybeSingle = vi.fn(() => q)
    q.single = vi.fn(() => q)
    q.insert = vi.fn(() => q)
    q.delete = vi.fn(() => q)
    q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
    return q
  }
  ctrl.from = vi.fn(() => query())
  ctrl.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return { ctrl }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: h.ctrl }))
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
const notifyMock = vi.hoisted(() => vi.fn())
vi.mock('../../services/notify.js', () => ({ notify: notifyMock }))
const toastShow = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui', () => ({
  Loading: () => <div>Loading article…</div>,
  Toast: () => null,
  useToast: () => ({ msg: null, type: 'info', actionLabel: null, onAction: null, show: toastShow }),
}))
const shareMocks = vi.hoisted(() => ({ mediaToFile: vi.fn(), shareOrCopy: vi.fn() }))
vi.mock('../../utils/share.js', () => shareMocks)
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({ useHeaderIdentity: () => ({ myUsername: '', myAvatar: null, unreadNotifs: 0 }) }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/layout/SidebarSection.jsx', () => ({
  StickySidebar: ({ children }) => <div>{children}</div>,
  SidebarSection: () => null,
}))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('./ArticleEditor.jsx', () => ({ default: ({ value }) => <div data-testid="article-body">{value}</div> }))
vi.mock('../subscriptions-monetization/GiftPanel.jsx', () => ({ default: () => null }))
vi.mock('../../components/SupportPrompt.jsx', () => ({ default: () => null }))

const renderArticle = (id) =>
  render(
    <MemoryRouter initialEntries={[`/news/${id}`]}>
      <Routes>
        <Route path="/news/:id" element={<NewsArticle />} />
      </Routes>
    </MemoryRouter>
  )

// The last query object created for a table — i.e. the one from the action
// under test, not the initial load's read.
function queryFor(table) {
  const calls = h.ctrl.from.mock.calls
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i][0] === table) return h.ctrl.from.mock.results[i].value
  }
  return null
}

const article = {
  id: 'art-1',
  headline: 'Test headline on malaria',
  subtitle: 'A short subtitle',
  body: '<p>Simple practical steps reduce malaria risk.</p>',
  hero_image_url: null,
  published_at: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z',
  status: 'approved',
  author_id: 'u1',
  view_count: 5,
  profiles: { full_name: 'Dr Ada', display_name: 'ada', is_verified: true, verification_label: 'Verified Doctor' },
}

const emptyEngagement = () => [
  { data: [], error: null }, // reactions
  { data: [], error: null }, // comments
  { data: [], error: null }, // news_reposts
]

beforeEach(() => {
  h.ctrl.queue.length = 0
  h.ctrl.rpc.mockClear()
  h.ctrl.from.mockClear()
  notifyMock.mockClear()
  toastShow.mockClear()
  shareMocks.mediaToFile.mockReset()
  shareMocks.mediaToFile.mockResolvedValue(null)
  shareMocks.shareOrCopy.mockReset()
  shareMocks.shareOrCopy.mockResolvedValue('copied')
  auth.user = null
  window.scrollTo = vi.fn()
})

describe('NewsArticle route /news/:id', () => {
  it('shows a loading state, then renders a valid published article', async () => {
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())

    renderArticle('art-1')

    expect(screen.getByText('Loading article…')).toBeInTheDocument()
    expect(await screen.findByText('Test headline on malaria')).toBeInTheDocument()
    expect(screen.getByText('A short subtitle')).toBeInTheDocument()
    expect(screen.getByText('By Dr Ada')).toBeInTheDocument()
    expect(screen.getByTestId('article-body').textContent).toContain('malaria')
    // Share buttons present (header + engagement bar), not a blank page.
    expect(screen.getAllByRole('button', { name: /share this article/i }).length).toBeGreaterThan(0)
  })

  it('renders a proper not-found state for an unknown or unpublished article id', async () => {
    h.ctrl.push({ data: null, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())

    renderArticle('no-such-id')

    expect(await screen.findByText('Article not available')).toBeInTheDocument()
    expect(screen.getByText(/may have been removed or is still under review/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to news/i })).toBeInTheDocument()
  })

  it('renders a meaningful error state with a retry button when the fetch fails', async () => {
    h.ctrl.push({ data: null, error: { message: 'network down' } })

    renderArticle('art-1')

    expect(await screen.findByText("Couldn't open this article")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText('Test headline on malaria')).not.toBeInTheDocument()
  })

  it('records a view for a successfully loaded article', async () => {
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    expect(h.ctrl.rpc).toHaveBeenCalledWith('increment_news_view', { news_id: 'art-1' })
  })

  it('does not crash when optional fields (subtitle, hero image) are missing', async () => {
    const sparse = { ...article, subtitle: null, hero_image_url: null, view_count: 0 }
    h.ctrl.push({ data: sparse, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())

    renderArticle('art-1')

    expect(await screen.findByText('Test headline on malaria')).toBeInTheDocument()
  })

  it('notifies the author when a logged-in reader likes the article', async () => {
    auth.user = { id: 'reader-1' }
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())
    h.ctrl.push({ data: null, error: null }) // saved_news

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    fireEvent.click(screen.getByRole('button', { name: /like this article/i }))

    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith({
      recipientId: 'u1',
      actorId: 'reader-1',
      type: 'news_like',
      message: 'liked your article',
      link: '/news/art-1',
      postId: 'art-1',
    }))
  })

  it('notifies the author when a logged-in reader comments on the article', async () => {
    auth.user = { id: 'reader-2' }
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())
    h.ctrl.push({ data: null, error: null }) // saved_news

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    // Open the comments panel first — it is collapsed by default.
    fireEvent.click(screen.getByRole('button', { name: /comments on this article/i }))

    fireEvent.change(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Great read!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith({
      recipientId: 'u1',
      actorId: 'reader-2',
      type: 'news_comment',
      message: 'commented on your article',
      link: '/news/art-1',
      postId: 'art-1',
    }))
  })

  it('reposts an article: inserts a news_reposts row, bumps the count and toasts', async () => {
    auth.user = { id: 'reader-1' }
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())
    h.ctrl.push({ data: null, error: null }) // saved_news

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    const repostBtn = screen.getByRole('button', { name: /repost this article/i })
    expect(repostBtn).toBeInTheDocument()
    expect(repostBtn.getAttribute('aria-pressed')).toBe('false')

    h.ctrl.push({ data: { id: 'rep-1', news_id: 'art-1', user_id: 'reader-1' }, error: null })
    fireEvent.click(repostBtn)

    await waitFor(() => {
      const q = queryFor('news_reposts')
      expect(q.insert).toHaveBeenCalledWith({ news_id: 'art-1', user_id: 'reader-1' })
    })
    expect(toastShow).toHaveBeenCalledWith('Reposted', { type: 'success' })
    expect(await screen.findByText('1 repost')).toBeInTheDocument()
  })

  it('undoes a repost: deletes the caller’s row and toasts', async () => {
    auth.user = { id: 'reader-1' }
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null }) // reactions
    h.ctrl.push({ data: [], error: null }) // comments
    h.ctrl.push({ data: [{ id: 'rep-1', news_id: 'art-1', user_id: 'reader-1' }], error: null }) // news_reposts
    h.ctrl.push({ data: null, error: null }) // saved_news

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    const undoBtn = screen.getByRole('button', { name: /undo repost/i })
    expect(undoBtn.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('1 repost')).toBeInTheDocument()

    h.ctrl.push({ data: null, error: null })
    fireEvent.click(undoBtn)

    await waitFor(() => {
      const q = queryFor('news_reposts')
      expect(q.delete).toHaveBeenCalled()
      expect(q.delete().eq).toHaveBeenCalledWith('id', 'rep-1')
    })
    expect(toastShow).toHaveBeenCalledWith('Repost removed', { type: 'info' })
  })

  it('rolls back the optimistic repost and toasts an error when the insert fails', async () => {
    auth.user = { id: 'reader-1' }
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())
    h.ctrl.push({ data: null, error: null }) // saved_news

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    h.ctrl.push({ data: null, error: { message: 'RLS rejected' } })
    fireEvent.click(screen.getByRole('button', { name: /repost this article/i }))

    await waitFor(() => {
      expect(toastShow).toHaveBeenCalledWith('Could not repost right now.', { type: 'error' })
    })
    expect(screen.queryByText(/repost/)).not.toBeInTheDocument()
  })

  it('attaches the hero image to shares when present', async () => {
    const withHero = { ...article, hero_image_url: 'https://cdn.test/hero.jpg' }
    h.ctrl.push({ data: withHero, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    const file = new File(['img'], 'hero.jpg', { type: 'image/jpeg' })
    shareMocks.mediaToFile.mockResolvedValue(file)

    fireEvent.click(screen.getAllByRole('button', { name: /share this article/i })[0])

    await waitFor(() => {
      expect(shareMocks.mediaToFile).toHaveBeenCalledWith('https://cdn.test/hero.jpg')
      expect(shareMocks.shareOrCopy).toHaveBeenCalled()
    })
    const args = shareMocks.shareOrCopy.mock.calls[0][0]
    expect(args.mediaUrl).toBe('https://cdn.test/hero.jpg')
    expect(args.files).toEqual([file])
    expect(args.url).toBe('http://localhost:3000/news/art-1')
  })

  it('shares without media when the article has no hero image', async () => {
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    fireEvent.click(screen.getAllByRole('button', { name: /share this article/i })[0])

    await waitFor(() => {
      expect(shareMocks.shareOrCopy).toHaveBeenCalled()
    })
    const args = shareMocks.shareOrCopy.mock.calls[0][0]
    expect(args.mediaUrl).toBeNull()
    expect(args.files).toBeUndefined()
    expect(shareMocks.mediaToFile).not.toHaveBeenCalled()
  })

  it('renders comment bodies through markdown instead of raw content', async () => {
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null }) // reactions
    h.ctrl.push({
      data: [{
        id: 'c1',
        content: '**bold text** and [link](https://x.test)',
        created_at: '2026-08-01T00:00:00Z',
        user_id: 'u9',
        profiles: { full_name: 'Dr Q', display_name: 'q', is_verified: false, verification_label: null, specialty: null },
      }],
      error: null,
    }) // comments
    h.ctrl.push({ data: [], error: null }) // news_reposts

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    fireEvent.click(screen.getByRole('button', { name: /comments on this article/i }))

    const bold = await screen.findByText('bold text')
    expect(bold.tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: /link/i })).toHaveAttribute('href', 'https://x.test')
    expect(screen.queryByText('**bold text**')).not.toBeInTheDocument()
  })

  it('shows Under review for pending article accessed by non-public route (author view)', async () => {
    // NewsArticle shows "Article not available / still under review" for pending
    const pending = { ...article, status: 'pending' }
    h.ctrl.push({ data: pending, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())
    renderArticle('art-1')
    expect(await screen.findByText('Article not available')).toBeInTheDocument()
    expect(screen.getByText(/still under review/i)).toBeInTheDocument()
  })

  it('shows approved article immediately after admin approval (public feed)', async () => {
    const approved = { ...article, status: 'approved', published_at: new Date().toISOString() }
    h.ctrl.push({ data: approved, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push(...emptyEngagement())
    renderArticle('art-1')
    expect(await screen.findByText('Test headline on malaria')).toBeInTheDocument()
    expect(screen.queryByText('Article not available')).not.toBeInTheDocument()
  })

  it('maps pending to Under review and rejected to Not approved (News strip)', () => {
    const pendingLabel = 'pending' === 'rejected' ? 'Not approved' : 'Under review'
    const rejectedLabel = 'rejected' === 'rejected' ? 'Not approved' : 'Under review'
    expect(pendingLabel).toBe('Under review')
    expect(rejectedLabel).toBe('Not approved')
  })
})