import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'

// Leaf/heavy children are irrelevant to these tests; stub them so the card
// renders purely through its own branches (text/article/visual/locked).
vi.mock('../../utils/VisualCard.jsx', () => ({
  default: () => <div data-testid="visual-card" />,
}))
vi.mock('../news-publishing/ArticleEditor.jsx', () => ({
  default: ({ value }) => <div data-testid="article-editor">{value}</div>,
}))
vi.mock('./PostMenu.jsx', () => ({
  default: () => null,
}))
vi.mock('./components/CommentThread.jsx', () => ({
  CommentThread: () => null,
}))

import PostCard from './PostCard.jsx'
import PostDetailModal from './PostDetailModal.jsx'

// The preview clamp is measured after mount (scrollHeight > clientHeight), so
// these two globals control whether a card shows "See more". jsdom reports 0
// for both by default.
let scrollH = 0
let clientH = 0
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollH })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientH })

function makePost(overrides = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    post_type: 'text',
    content: 'A long enough opening sentence so the preview body overflows the clamp line budget here.',
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

function makeCardProps(overrides = {}) {
  return {
    user: null,
    navigate: vi.fn(),
    profiles: {},
    authorName: () => 'Dr Test',
    formatCount: (n) => n,
    timeAgo: () => 'now',
    likeCount: () => 0,
    userHasLiked: () => false,
    commentTotal: () => 0,
    shareCount: () => 0,
    saveCount: () => 0,
    giftCount: () => 0,
    userHasReposted: () => false,
    isSaved: () => false,
    isFollowing: () => false,
    toggleLike: vi.fn(),
    toggleComments: vi.fn(),
    toggleRepost: vi.fn(),
    toggleSave: vi.fn(),
    toggleFollow: vi.fn(),
    sharePost: vi.fn(),
    shareCard: vi.fn(),
    openReport: vi.fn(),
    onGift: vi.fn(),
    handleEditPost: vi.fn(),
    handleCommentAdded: vi.fn(),
    openComments: {},
    comments: {},
    setComments: vi.fn(),
    editingComment: null,
    setEditingComment: vi.fn(),
    replyingTo: null,
    setReplyingTo: vi.fn(),
    commentDrafts: {},
    setCommentDrafts: vi.fn(),
    myUsername: '',
    myAvatar: null,
    reportedPosts: [],
    sharingId: null,
    editingPost: null,
    setEditingPost: vi.fn(),
    setConfirmDeleteId: vi.fn(),
    onOpenDetail: vi.fn(),
    ...overrides,
  }
}

describe('PostCard preview clamp + See more', () => {
  it('shows the See more button when the body genuinely overflows', async () => {
    scrollH = 100
    clientH = 50
    render(
      <MemoryRouter>
        <PostCard post={makePost()} {...makeCardProps()} />
      </MemoryRouter>
    )
    const seeMore = await screen.findByRole('button', { name: /expand the full post by dr test/i })
    expect(seeMore).toBeInTheDocument()
    expect(seeMore).toHaveTextContent(/see more/i)
  })

  it('never shows See more when the body fits', async () => {
    scrollH = 50
    clientH = 100
    render(
      <MemoryRouter>
        <PostCard post={makePost()} {...makeCardProps()} />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: /expand the full post by dr test/i })).not.toBeInTheDocument())
  })

  it('See more expands inline and then collapses with Show less (no navigation)', async () => {
    scrollH = 100
    clientH = 50
    const onOpenDetail = vi.fn()
    render(
      <MemoryRouter>
        <PostCard post={makePost()} {...makeCardProps({ onOpenDetail })} />
      </MemoryRouter>
    )
    const seeMore = await screen.findByRole('button', { name: /expand the full post by dr test/i })
    fireEvent.click(seeMore)
    // Expands: Show less appears, onOpenDetail is NOT called (inline, not modal)
    expect(await screen.findByRole('button', { name: /collapse post by dr test/i })).toBeInTheDocument()
    expect(onOpenDetail).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /collapse post by dr test/i })).toHaveTextContent(/show less/i)
    fireEvent.click(screen.getByRole('button', { name: /collapse post by dr test/i }))
    expect(await screen.findByRole('button', { name: /expand the full post by dr test/i })).toBeInTheDocument()
  })

  it('the detail modal renders the full post with no See more button', async () => {
    scrollH = 100
    clientH = 50
    render(
      <MemoryRouter>
        <PostDetailModal
          show
          post={makePost({ content: 'The complete post body shown in full inside the modal.' })}
          loading={false}
          error=""
          onClose={vi.fn()}
          cardProps={makeCardProps()}
        />
      </MemoryRouter>
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/The complete post body shown in full inside the modal/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /expand the full post by dr test/i })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /collapse post by dr test/i })).not.toBeInTheDocument()
  })

  it('the detail modal shows its loading and error states', async () => {
    render(
      <MemoryRouter>
        <PostDetailModal show post={null} loading onClose={vi.fn()} cardProps={makeCardProps()} />
      </MemoryRouter>
    )
    expect(await screen.findByText('Loading post...')).toBeInTheDocument()
  })

  it('renders a deleted/unreachable deep-linked post as an error', async () => {
    render(
      <MemoryRouter>
        <PostDetailModal
          show
          post={null}
          loading={false}
          error="This post is no longer available."
          onClose={vi.fn()}
          cardProps={makeCardProps()}
        />
      </MemoryRouter>
    )
    expect(await screen.findByText('This post is no longer available.')).toBeInTheDocument()
  })

  it('renders a locked teaser through the markdown renderer and never offers See more', async () => {
    scrollH = 100
    clientH = 50
    const { container } = render(
      <MemoryRouter>
        <PostCard
          post={makePost({ content: '**bold** subscriber tip' })}
          {...makeCardProps({ isLocked: () => true })}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Subscriber-only content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /subscribe to read/i })).toBeInTheDocument()
    expect(container.textContent).not.toContain('**')
    expect(container.querySelector('strong')).not.toBeNull()
    expect(container.querySelector('strong').textContent).toBe('bold')
    expect(screen.queryByRole('button', { name: /expand the full post by dr test/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collapse post by dr test/i })).not.toBeInTheDocument()
  })

  it('still shows the engagement bar and its Share action', async () => {
    scrollH = 50
    clientH = 100
    render(
      <MemoryRouter>
        <PostCard post={makePost()} {...makeCardProps()} />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /share this post/i })).toBeInTheDocument()
  })
})

// Issue #2 — a repost must name BOTH who shared it and who wrote it. The
// reposter's name sits above the source card, and the explicit "Originally
// posted by Y" clause means even a reader who never scrolls into the source
// card cannot mistake the reposter for the writer.
describe('PostCard repost attribution (issue #2)', () => {
  const source = makePost({ id: 'p0', user_id: 'author-1', content: 'The original words of the article.' })
  const namesByUser = (p) => (p.user_id === 'author-1' ? 'Dr Original' : 'Ms Reposter')

  function renderRepost({ resolveSource }) {
    return render(
      <MemoryRouter>
        <PostCard
          post={makePost({ id: 'p9', user_id: 'reposter-1', repost_of: 'p0', content: '', image_url: null })}
          {...makeCardProps({ authorName: namesByUser })}
          resolveSource={resolveSource}
        />
      </MemoryRouter>
    )
  }

  it('credits the reposter AND the original author', () => {
    scrollH = 50
    clientH = 100
    const { container } = renderRepost({ resolveSource: (id) => (id === 'p0' ? source : null) })
    const text = container.textContent
    expect(text).toContain('Reposted by')
    expect(text).toContain('Ms Reposter')
    expect(text).toContain('Originally posted by')
    expect(text).toContain('Dr Original')
    // The body shown is the SOURCE's words, not the repost row's emptiness.
    expect(text).toContain('The original words of the article.')
  })

  it('keeps the reposter credit honest when the source cannot be resolved', () => {
    scrollH = 50
    clientH = 100
    const { container } = renderRepost({ resolveSource: () => null })
    const text = container.textContent
    expect(text).toContain('Reposted by')
    expect(text).toContain('Ms Reposter')
    expect(text).toContain('This post is no longer available.')
    // Never fall back to crediting the reposter as the writer.
    expect(text).not.toContain('Originally posted by')
  })
})