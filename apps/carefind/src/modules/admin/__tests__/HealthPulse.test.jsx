import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const mockGetHealthPulse = vi.fn()

vi.mock('../repositories', () => ({
  dashboardRepository: {
    getHealthPulse: (...args) => mockGetHealthPulse(...args),
  },
}))

vi.mock('../../../styles/theme', () => ({
  theme: {
    cardBg: '#fff',
    border: '#e0e0e0',
    textDark: '#111',
    textMid: '#555',
    textLight: '#888',
    success: '#0E6F5A',
    fontFamily: 'sans-serif',
    radius: { sm: 4, md: 8, lg: 12 },
    space: [0, 4, 8, 12, 16],
  },
}))

import HealthPulse from '../HealthPulse.jsx'

const PULSE_DATA = {
  revenueToday: 15000,
  pendingItems: 7,
  activeLives: 3,
  openDisputes: 2,
}

describe('HealthPulse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetHealthPulse.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders null while loading', () => {
    mockGetHealthPulse.mockReturnValue(new Promise(() => {}))
    const { container } = render(<HealthPulse onNavigate={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows 4 pulse items after data loads', async () => {
    mockGetHealthPulse.mockResolvedValue(PULSE_DATA)
    render(<HealthPulse onNavigate={vi.fn()} />)
    await act(async () => { vi.advanceTimersByTime(0) })

    expect(screen.getByText('Revenue Today')).toBeInTheDocument()
    expect(screen.getByText('Pending Items')).toBeInTheDocument()
    expect(screen.getByText('Active Lives')).toBeInTheDocument()
    expect(screen.getByText('Open Disputes')).toBeInTheDocument()
  })

  it('shows Platform Pulse header', async () => {
    mockGetHealthPulse.mockResolvedValue(PULSE_DATA)
    render(<HealthPulse onNavigate={vi.fn()} />)
    await act(async () => { vi.advanceTimersByTime(0) })

    expect(screen.getByText('Platform Pulse')).toBeInTheDocument()
  })

  it('calls onNavigate when a pulse item is clicked', async () => {
    const onNavigate = vi.fn()
    mockGetHealthPulse.mockResolvedValue(PULSE_DATA)
    render(<HealthPulse onNavigate={onNavigate} />)
    await act(async () => { vi.advanceTimersByTime(0) })

    fireEvent.click(screen.getByText('Revenue Today').closest('button'))
    expect(onNavigate).toHaveBeenCalledWith('revenue')

    fireEvent.click(screen.getByText('Pending Items').closest('button'))
    expect(onNavigate).toHaveBeenCalledWith('notifications')

    fireEvent.click(screen.getByText('Active Lives').closest('button'))
    expect(onNavigate).toHaveBeenCalledWith('golive')

    fireEvent.click(screen.getByText('Open Disputes').closest('button'))
    expect(onNavigate).toHaveBeenCalledWith('reports')
  })

  it('shows refresh button', async () => {
    mockGetHealthPulse.mockResolvedValue(PULSE_DATA)
    render(<HealthPulse onNavigate={vi.fn()} />)
    await act(async () => { vi.advanceTimersByTime(0) })

    const buttons = screen.getAllByRole('button')
    const refreshBtn = buttons.find(btn => btn.querySelector('svg'))
    expect(refreshBtn).toBeTruthy()
  })

  it('auto-refreshes every 30 seconds', async () => {
    mockGetHealthPulse.mockResolvedValue(PULSE_DATA)
    render(<HealthPulse onNavigate={vi.fn()} />)

    await act(async () => { vi.advanceTimersByTime(0) })
    expect(mockGetHealthPulse).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(30000) })
    expect(mockGetHealthPulse).toHaveBeenCalledTimes(2)

    await act(async () => { vi.advanceTimersByTime(30000) })
    expect(mockGetHealthPulse).toHaveBeenCalledTimes(3)
  })
})
