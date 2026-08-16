import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import StoryViewer from './StoryViewer.jsx'

const stories = [
  { id: 's1', title: 'First', body: 'one', bg_color: '#0E6F5A', created_at: '2026-08-01T10:00:00Z' },
  { id: 's2', title: 'Second', body: 'two', bg_color: '#7c3aed', created_at: '2026-08-02T10:00:00Z' },
]

function renderViewer(overrides = {}) {
  const props = {
    stories,
    index: 0,
    onNavigate: vi.fn(),
    onClose: vi.fn(),
    onViewStory: vi.fn(),
    renderHeader: (s) => <div>Author: {s.title}</div>,
    ...overrides,
  }
  render(<StoryViewer {...props} />)
  return props
}

describe('StoryViewer (Feature 8 — shared sequential viewer)', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the current story title and body', () => {
    renderViewer()
    expect(screen.getByRole('heading', { name: 'First' })).toBeTruthy()
    expect(screen.getByText('one')).toBeTruthy()
    expect(screen.getByText('Author: First')).toBeTruthy()
  })

  it('calls onViewStory once for the story being watched', () => {
    const { onViewStory } = renderViewer()
    expect(onViewStory).toHaveBeenCalledTimes(1)
    expect(onViewStory).toHaveBeenCalledWith(stories[0])
  })

  it('auto-advances to the next story after the duration elapses', () => {
    vi.useFakeTimers()
    try {
      const { onNavigate } = renderViewer()
      onNavigate.mockClear()
      vi.advanceTimersByTime(6000)
      expect(onNavigate).toHaveBeenCalledWith(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances on tapping the next zone and goes back on the previous zone', () => {
    const { onNavigate } = renderViewer()
    onNavigate.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Next story' }))
    expect(onNavigate).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Previous story' }))
    expect(onNavigate).toHaveBeenCalledWith(-1)
  })

  it('closes via the close button', () => {
    const { onClose } = renderViewer()
    fireEvent.click(screen.getByRole('button', { name: 'Close story' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the index is out of range', () => {
    renderViewer({ index: 99 })
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('renders an image story instead of the text block when image_url is set', () => {
    renderViewer({
      stories: [{ id: 's3', image_url: 'https://img.test/a.png', title: 'Photo', created_at: '2026-08-01T10:00:00Z' }],
      index: 0,
    })
    expect(screen.getByRole('heading', { name: 'Photo' })).toBeTruthy()
    expect(screen.queryByText('one')).toBeNull()
  })

  it('renders markdown in the title and body instead of leaking syntax', () => {
    renderViewer({
      stories: [{ id: 's4', title: '**Hydration**', body: 'Stay **hydrated** and drink `water`', bg_color: '#0E6F5A', created_at: '2026-08-01T10:00:00Z' }],
      index: 0,
      // Header renders its own copy of the title — keep it out so the leak
      // assertions only inspect the story title/body content.
      renderHeader: () => <div>Author</div>,
    })
    expect(screen.getByRole('heading', { name: 'Hydration' })).toBeTruthy()
    expect(screen.getByText('hydrated')).toBeTruthy()
    expect(screen.getByText('water')).toBeTruthy()
    expect(screen.queryByText(/\*\*/)).toBeNull()
    expect(screen.queryByText(/`/)).toBeNull()
  })

  it('does not auto-advance past the last story (parent closes instead)', () => {
    vi.useFakeTimers()
    try {
      const { onNavigate } = renderViewer({ index: stories.length - 1 })
      onNavigate.mockClear()
      vi.advanceTimersByTime(6000)
      expect(onNavigate).toHaveBeenCalledWith(stories.length)
    } finally {
      vi.useRealTimers()
    }
  })
})
