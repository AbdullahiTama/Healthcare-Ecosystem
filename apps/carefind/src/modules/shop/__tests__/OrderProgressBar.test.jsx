import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import OrderProgressBar from '../OrderProgressBar'
import { theme } from '../../../styles/theme'

// Mock theme
vi.mock('../../../styles/theme', () => ({
  theme: {
    radius: { md: 8, lg: 12 },
    cardBg: '#fff',
    border: '#e5e7eb',
    gray200: '#e5e7eb',
    gray300: '#d1d5db',
    gray400: '#9ca3af',
    tealDeep: '#0E6F5A',
    success: '#10b981',
    textMid: '#6b7280',
    navy: '#1f2937',
    warning: '#f59e0b',
  },
}))

describe('OrderProgressBar', () => {
  it('returns null for cancelled orders', () => {
    const { container } = render(
      <OrderProgressBar order={{ status: 'cancelled' }} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null for pending_payment orders', () => {
    const { container } = render(
      <OrderProgressBar order={{ status: 'pending_payment' }} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null for disputed orders', () => {
    const { container } = render(
      <OrderProgressBar order={{ status: 'disputed' }} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders progress bar for paid order', () => {
    render(<OrderProgressBar order={{ status: 'paid' }} />)
    expect(screen.getByText('13%')).toBeInTheDocument()
  })

  it('renders progress bar for processing order', () => {
    render(<OrderProgressBar order={{ status: 'processing' }} />)
    expect(screen.getByText('38%')).toBeInTheDocument()
  })

  it('renders progress bar for delivered order', () => {
    render(<OrderProgressBar order={{ status: 'delivered' }} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('shows emotional status message', () => {
    render(<OrderProgressBar order={{ status: 'processing' }} />)
    expect(screen.getByText(/being carefully prepared/i)).toBeInTheDocument()
  })

  it('shows emoji for status', () => {
    render(<OrderProgressBar order={{ status: 'delivered' }} />)
    expect(screen.getByText(/🎊/)).toBeInTheDocument()
  })
})
