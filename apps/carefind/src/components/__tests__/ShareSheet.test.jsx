import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareSheet from '../ShareSheet.jsx'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  url: 'https://carefind.app/post/abc-123',
  title: 'Test Post',
  text: 'Check out this post',
  mediaUrl: '',
  files: [],
  onShareComplete: vi.fn(),
}

function renderSheet(overrides = {}) {
  return render(<ShareSheet {...defaultProps} {...overrides} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShareSheet', () => {
  it('renders nothing when open is false', () => {
    const { container } = renderSheet({ open: false })
    expect(container.firstChild).toBeNull()
  })

  it('renders the share dialog when open is true', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument()
  })

  it('shows quick share target buttons', () => {
    renderSheet()
    expect(screen.getByRole('button', { name: 'Share on WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share on X' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share on Telegram' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  })

  it('shows the "Add a thought" input', () => {
    renderSheet()
    const input = screen.getByPlaceholderText('Add a thought...')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('TEXTAREA')
  })

  it('composes share text with note when typed', async () => {
    const shareMock = vi.fn().mockResolvedValue('shared')
    Object.defineProperty(navigator, 'share', { value: shareMock, writable: true, configurable: true })

    renderSheet()
    const textarea = screen.getByPlaceholderText('Add a thought...')
    fireEvent.change(textarea, { target: { value: 'Great read!' } })

    const shareBtn = screen.getByRole('button', { name: 'Share' })
    fireEvent.click(shareBtn)

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalled()
    })

    const payload = shareMock.mock.calls[0][0]
    expect(payload.text).toContain('Great read!')
    expect(payload.text).toContain('https://carefind.app/post/abc-123')

    delete navigator.share
  })

  it('copy link button copies URL to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })

    renderSheet()
    const copyBtn = screen.getByRole('button', { name: 'Copy link' })
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://carefind.app/post/abc-123')
    })
  })

  it('shows "Link copied!" after copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })

    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))

    await waitFor(() => {
      expect(screen.getByText('Link copied!')).toBeInTheDocument()
    })
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close share sheet' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderSheet({ onClose })
    const overlay = container.firstChild
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
