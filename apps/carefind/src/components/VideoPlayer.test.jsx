import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VideoPlayer from './VideoPlayer'

describe('VideoPlayer', () => {
  it('renders a muted inline video with metadata preload and a loading state', () => {
    const { container } = render(<VideoPlayer src="https://cdn.example.com/clip.mp4" ariaLabel="Dr Ada's video" />)

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video.getAttribute('src')).toBe('https://cdn.example.com/clip.mp4')
    expect(video.muted).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.preload).toBe('metadata')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('swaps the loading state for the video once it can play', () => {
    const { container } = render(<VideoPlayer src="clip.mp4" />)

    fireEvent.canPlay(container.querySelector('video'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(container.querySelector('video').controls).toBe(false)
  })

  it('shows an error fallback with a Retry button when the video fails to load', () => {
    const { container } = render(<VideoPlayer src="broken.mp4" />)

    fireEvent.error(container.querySelector('video'))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows a manual play button when autoplay is off and the video is ready', () => {
    const { container } = render(<VideoPlayer src="clip.mp4" autoPlay={false} />)

    fireEvent.canPlay(container.querySelector('video'))
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument()
  })

  it('reports the source to the DOM without leaking undefined poster', () => {
    const { container } = render(<VideoPlayer src="clip.mp4" />)
    const video = container.querySelector('video')
    expect(video.hasAttribute('poster')).toBe(false)
  })

  it('renders muted then unmute toggles video.muted and icon', () => {
    const { container } = render(<VideoPlayer src="clip.mp4" />)
    const video = container.querySelector('video')
    expect(video.muted).toBe(true)
    fireEvent.canPlay(video)
    const unmuteBtn = screen.getByRole('button', { name: /unmute/i })
    expect(unmuteBtn).toBeInTheDocument()
    fireEvent.click(unmuteBtn)
    expect(video.muted).toBe(false)
    expect(screen.getByRole('button', { name: /mute video/i })).toBeInTheDocument()
    // toggle back
    fireEvent.click(screen.getByRole('button', { name: /mute video/i }))
    expect(video.muted).toBe(true)
    expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument()
  })

  it('unmute button is available in controls mode', () => {
    const { container } = render(<VideoPlayer src="clip.mp4" controls />)
    fireEvent.canPlay(container.querySelector('video'))
    expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument()
  })
})
