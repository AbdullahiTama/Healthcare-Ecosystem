import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import News from './News.jsx'

// Hoisted supabase mock with queue, similar to newsArticle.test.jsx
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
    q.update = vi.fn(() => q)
    q.then = (resolve) => resolve(ctrl.queue.shift() || { data: null, error: null })
    return q
  }
  ctrl.from = vi.fn(() => query())
  ctrl.rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
  ctrl.storage = { from: vi.fn(() => ({ upload: vi.fn(() => Promise.resolve({ error: null })), getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'http://example.com/img.jpg' } })) })) }
  return { ctrl }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: h.ctrl }))
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))
const toastShow = vi.hoisted(() => vi.fn())
vi.mock('../../components/ui', () => ({
  CardSkeleton: () => <div>CardSkeleton</div>,
  ErrorState: ({ message }) => <div>{message}</div>,
  Toast: () => null,
  useToast: () => ({ msg: '', type: 'info', actionLabel: null, onAction: null, show: toastShow }),
}))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({ useHeaderIdentity: () => ({ myUsername: '', myAvatar: null, unreadNotifs: 0 }) }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('./ArticleEditor.jsx', () => ({ default: ({ value, readOnly }) => <div data-testid="article-editor">{readOnly ? `read:${value}` : `edit:${value}`}</div> }))

const renderNews = () =>
  render(
    <MemoryRouter>
      <News />
    </MemoryRouter>
  )

beforeEach(() => {
  h.ctrl.queue.length = 0
  h.ctrl.from.mockClear()
  h.ctrl.rpc.mockClear()
  toastShow.mockClear()
  auth.user = null
})

describe('News preview engagement', () => {
  it('renders engagement row in preview without scrolling (visible without open article)', async () => {
    auth.user = { id: 'u1' }
    // loadNews: approved articles [] + my pending []
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: null, error: null }) // profiles update (markNewsSeen)
    renderNews()
    // Wait for initial load
    await waitFor(() => expect(screen.queryByText('CardSkeleton')).not.toBeInTheDocument())
    // Open composer
    const submitBtn = screen.getByRole('button', { name: /submit a news story/i })
    fireEvent.click(submitBtn)
    // Toggle preview — there are two Preview buttons (header and form); pick the first
    const previewBtn = screen.getAllByRole('button', { name: /preview/i })[0]
    fireEvent.click(previewBtn)
    const engRow = document.querySelector('.cf-eng-row')
    expect(engRow).toBeInTheDocument()
    // Check that Like/Comment/Share/Repost are present
    expect(screen.getByRole('button', { name: /like this article/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /comments on this article/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /share this article/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /repost this article/i })).toBeInTheDocument()
    // Style check: padding 4px 18px, margin 8px 0, borderTop/Bottom
    expect(engRow.getAttribute('style')).toMatch(/padding/)
    // Check disabled with tooltip
    expect(screen.getByRole('button', { name: /like this article/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /like this article/i }).getAttribute('title')).toBe('Publish to enable engagement')
    expect(screen.getByRole('button', { name: /repost this article/i })).toBeDisabled()
  })

  it('preview engagement buttons are disabled with Publish to enable tooltip (draft news_id null case)', async () => {
    auth.user = { id: 'u1' }
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: null, error: null })
    renderNews()
    await waitFor(() => expect(screen.queryByText('CardSkeleton')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /submit a news story/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])
    const buttons = ['Like this article', 'Comments on this article', 'Share this article', 'Repost this article']
    for (const name of buttons) {
      const btn = screen.getByRole('button', { name: new RegExp(name, 'i') })
      expect(btn).toBeDisabled()
      expect(btn.getAttribute('title')).toBe('Publish to enable engagement')
    }
  })

  it('preview engagement row uses same cf-eng-row structure as article (has cf-eng-group and cf-eng-item)', async () => {
    auth.user = { id: 'u1' }
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: [], error: null })
    h.ctrl.push({ data: null, error: null })
    renderNews()
    await waitFor(() => expect(screen.queryByText('CardSkeleton')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /submit a news story/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])
    const row = document.querySelector('.cf-eng-row')
    expect(row).toBeInTheDocument()
    expect(row.querySelectorAll('.cf-eng-group').length).toBeGreaterThanOrEqual(1)
    expect(row.querySelectorAll('.cf-eng-item').length).toBeGreaterThanOrEqual(4)
    // Check expected inline style values per spec
    const style = row.getAttribute('style') || ''
    expect(style).toContain('4px 18px')
    expect(style).toContain('8px 0')
  })
})
