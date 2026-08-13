import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import NewsArticle from './NewsArticle.jsx'

// Queue-based supabase mock. Each awaited query resolves with the next queued
// result, in the order NewsArticle makes them: [article, more-news,
// reactions, comments] (saved_news only fires when a user is present).
const h = vi.hoisted(() => {
  const ctrl = { queue: [] }
  ctrl.push = (...results) => { ctrl.queue.push(...results); return ctrl }
  const query = () => {
    const q = {}
    q.select = () => q
    q.eq = () => q
    q.neq = () => q
    q.order = () => q
    q.limit = () => q
    q.maybeSingle = () => q
    q.single = () => q
    q.insert = () => q
    q.delete = () => q
    q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
    return q
  }
  ctrl.from = vi.fn(() => query())
  ctrl.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
  return { ctrl }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: h.ctrl }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
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
vi.mock('../../components/ui', () => ({ Loading: () => <div>Loading article…</div> }))

const renderArticle = (id) =>
  render(
    <MemoryRouter initialEntries={[`/news/${id}`]}>
      <Routes>
        <Route path="/news/:id" element={<NewsArticle />} />
      </Routes>
    </MemoryRouter>
  )

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

beforeEach(() => {
  h.ctrl.queue.length = 0
  h.ctrl.rpc.mockClear()
  h.ctrl.from.mockClear()
  window.scrollTo = vi.fn()
})

describe('NewsArticle route /news/:id', () => {
  it('shows a loading state, then renders a valid published article', async () => {
    h.ctrl.push({ data: article, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

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
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

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
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderArticle('art-1')
    await screen.findByText('Test headline on malaria')

    expect(h.ctrl.rpc).toHaveBeenCalledWith('increment_news_view', { news_id: 'art-1' })
  })

  it('does not crash when optional fields (subtitle, hero image) are missing', async () => {
    const sparse = { ...article, subtitle: null, hero_image_url: null, view_count: 0 }
    h.ctrl.push({ data: sparse, error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })

    renderArticle('art-1')

    expect(await screen.findByText('Test headline on malaria')).toBeInTheDocument()
  })
})
