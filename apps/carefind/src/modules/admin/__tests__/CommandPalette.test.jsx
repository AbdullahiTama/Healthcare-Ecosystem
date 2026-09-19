import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

Element.prototype.scrollIntoView = vi.fn()

vi.mock('../../../styles/theme', () => ({
  theme: {
    overlay: 'rgba(0,0,0,0.5)',
    cardBg: '#fff',
    border: '#e0e0e0',
    textDark: '#111',
    textMid: '#555',
    textLight: '#888',
    gray100: '#f5f5f5',
    gray400: '#999',
    gray500: '#777',
    tealDeep: '#0E6F5A',
    tealMist: '#e6f5f0',
    fontFamily: 'sans-serif',
    radius: { sm: 4, md: 8, lg: 12 },
    elevation: { 4: '0 4px 12px rgba(0,0,0,0.1)' },
    motion: { base: '0.2s', fast: '0.1s', easeOut: 'ease-out' },
    space: [0, 4, 8, 12, 16],
  },
}))

vi.mock('../AdminSidebar', () => ({
  NAV_GROUPS: [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { key: 'overview', label: 'Dashboard', icon: () => null },
        { key: 'notifications', label: 'Alerts', icon: () => null },
      ],
    },
    {
      id: 'content',
      label: 'Content',
      items: [
        { key: 'verifications', label: 'Verifications', icon: () => null },
        { key: 'reports', label: 'Reports', icon: () => null },
      ],
    },
  ],
  default: () => null,
}))

import CommandPalette from '../CommandPalette.jsx'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  onSignOut: vi.fn(),
  onRefresh: vi.fn(),
  permissions: {},
}

function renderPalette(overrides = {}) {
  const props = { ...defaultProps, ...overrides }
  return render(<CommandPalette {...props} />)
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when open is false', () => {
    const { container } = renderPalette({ open: false })
    expect(container.innerHTML).toBe('')
  })

  it('renders search input when open is true', () => {
    renderPalette()
    expect(screen.getByPlaceholderText('Jump to...')).toBeInTheDocument()
  })

  it('shows all tabs when query is empty', () => {
    renderPalette()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Verifications')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByText('Sign out')).toBeInTheDocument()
    expect(screen.getByText('Refresh data')).toBeInTheDocument()
  })

  it('filters tabs when query is typed', () => {
    renderPalette()
    const input = screen.getByPlaceholderText('Jump to...')
    fireEvent.change(input, { target: { value: 'Dash' } })
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Verifications')).not.toBeInTheDocument()
    expect(screen.queryByText('Reports')).not.toBeInTheDocument()
  })

  it('calls onNavigate when a tab is selected', () => {
    const onNavigate = vi.fn()
    renderPalette({ onNavigate })
    fireEvent.click(screen.getByText('Dashboard'))
    expect(onNavigate).toHaveBeenCalledWith('overview')
  })

  it('calls onSignOut when sign out action is selected', () => {
    const onSignOut = vi.fn()
    renderPalette({ onSignOut })
    fireEvent.click(screen.getByText('Sign out'))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('calls onRefresh when refresh action is selected', () => {
    const onRefresh = vi.fn()
    renderPalette({ onRefresh })
    fireEvent.click(screen.getByText('Refresh data'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('Enter selects the active item', () => {
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    renderPalette({ onNavigate, onClose })
    const input = screen.getByPlaceholderText('Jump to...')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('overview')
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the overlay calls onClose', () => {
    const onClose = vi.fn()
    const { container } = renderPalette({ onClose })
    const overlay = container.firstChild
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('hides tabs where permissions[key] === false', () => {
    renderPalette({ permissions: { verifications: false } })
    expect(screen.queryByText('Verifications')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })
})
