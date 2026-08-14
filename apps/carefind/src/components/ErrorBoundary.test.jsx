import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary.jsx'

const Boom = () => { throw new Error('boom') }

// Suppress the expected React error logging for the crashing child.
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterAll(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeInTheDocument()
  })

  it('shows a friendly fallback instead of unmounting the tree', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByText(/something went wrong here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go to feed/i })).toBeInTheDocument()
  })

  it('recovers when "Try again" is pressed after the error clears', () => {
    let fail = true
    const Flaky = () => { if (fail) throw new Error('boom'); return <p>recovered</p> }
    const { rerender } = render(<ErrorBoundary><Flaky /></ErrorBoundary>)
    expect(screen.getByText(/something went wrong here/i)).toBeInTheDocument()
    fail = false
    rerender(<ErrorBoundary><Flaky /></ErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })
})