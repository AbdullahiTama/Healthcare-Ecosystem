import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostTile } from './postDisplay.jsx'

describe('PostTile (Feature 7 — no markdown leak in grid tiles)', () => {
  it('renders the preview with markdown syntax stripped (no literal asterisks)', () => {
    render(<PostTile post={{ id: 'p1', content: 'Take **vitamin C** every day', post_type: 'text' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Take vitamin C every day')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('strips italic, inline-code and heading marks too', () => {
    render(<PostTile post={{ id: 'p2', content: '# Daily tip: drink *more* `water`', post_type: 'text' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Daily tip: drink more water')).toBeInTheDocument()
  })

  it('keeps stripping the repost mark and legacy bracket markers', () => {
    render(<PostTile post={{ id: 'p3', content: '🔁 {b}Reposted note{/b}', post_type: 'text' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Reposted note')).toBeInTheDocument()
  })
})