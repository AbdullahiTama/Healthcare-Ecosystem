import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PostTile, imagesOf } from './postDisplay.jsx'

function renderTile(props) {
  return render(
    <MemoryRouter>
      <PostTile {...props} />
    </MemoryRouter>
  )
}

describe('PostTile (Feature 7 — no markdown leak in grid tiles)', () => {
  it('renders the preview with markdown syntax stripped (no literal asterisks)', () => {
    renderTile({ post: { id: 'p1', content: 'Take **vitamin C** every day', post_type: 'text' }, onOpen: vi.fn() })
    expect(screen.getByText('Take vitamin C every day')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('strips italic, inline-code and heading marks too', () => {
    renderTile({ post: { id: 'p2', content: '# Daily tip: drink *more* `water`', post_type: 'text' }, onOpen: vi.fn() })
    expect(screen.getByText('Daily tip: drink more water')).toBeInTheDocument()
  })

  it('keeps stripping the repost mark and legacy bracket markers', () => {
    renderTile({ post: { id: 'p3', content: '🔁 {b}Reposted note{/b}', post_type: 'text' }, onOpen: vi.fn() })
    expect(screen.getByText('Reposted note')).toBeInTheDocument()
  })
})

// Issue #7 — multi-image posts. image_urls is the canonical list; the legacy
// single image_url is the fallback so pre-column posts keep rendering.
describe('imagesOf (issue #7)', () => {
  it('returns the image_urls list in order', () => {
    const post = { image_urls: ['a.jpg', 'b.jpg', 'c.jpg'], image_url: 'a.jpg' }
    expect(imagesOf(post)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('filters non-string and empty entries', () => {
    const post = { image_urls: ['ok.jpg', null, '', 42, 'also-ok.jpg'] }
    expect(imagesOf(post)).toEqual(['ok.jpg', 'also-ok.jpg'])
  })

  it('falls back to the legacy single image_url', () => {
    expect(imagesOf({ image_url: 'legacy.jpg' })).toEqual(['legacy.jpg'])
  })

  it('returns empty for a text-only post or a missing post', () => {
    expect(imagesOf({})).toEqual([])
    expect(imagesOf(null)).toEqual([])
  })
})
