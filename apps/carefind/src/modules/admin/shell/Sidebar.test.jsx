import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('../adminApi', () => ({ callAdminAuth: vi.fn(), SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('../../social-feed/Logo', () => ({ default: () => <span>logo</span> }))

import { renderAdmin } from '../test/renderAdmin.jsx'
import Sidebar from './Sidebar.jsx'

const base = { collapsed: false, onToggleCollapse: () => {}, counts: {}, countsFailed: false, isMobile: false, mobileOpen: false, onCloseMobile: () => {} }

describe('Sidebar', () => {
  it('shows every group to a super admin and marks the current screen', () => {
    renderAdmin(<Sidebar {...base} />, { route: '/admin/moderation/reports' })
    ;['Moderation', 'Content', 'Community', 'Directory', 'Commerce', 'Finance', 'Agents', 'Platform']
      .forEach(label => expect(screen.getByText(label)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveAttribute('aria-current')
  })

  it('hides screens and whole groups a restricted role may not see', () => {
    renderAdmin(<Sidebar {...base} />, { admin: { id: 'm', role: 'moderator' }, permissions: { withdrawals: false, users: false } })
    expect(screen.queryByText('Agents')).not.toBeInTheDocument()
    expect(screen.queryByText('Finance')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Directory manager/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tasks/ })).toBeInTheDocument()
  })

  it('shows a pending count in the link name and omits zero or unknown counts', () => {
    renderAdmin(<Sidebar {...base} counts={{ verifications: 12, reports: 0, claims: null, queue: 120 }} />)
    expect(screen.getByRole('link', { name: 'Verifications, 12 pending' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Queue, 120 pending' })).toHaveTextContent('99+')
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Claims' })).toBeInTheDocument()
  })

  it('says when counts are incomplete', () => {
    renderAdmin(<Sidebar {...base} countsFailed />)
    expect(screen.getByText('Some counts could not be loaded')).toBeInTheDocument()
  })

  it('keeps links named when collapsed', () => {
    renderAdmin(<Sidebar {...base} collapsed counts={{ verifications: 3 }} />)
    expect(screen.getByRole('link', { name: 'Verifications, 3 pending' })).toBeInTheDocument()
    expect(screen.queryByText('Moderation')).not.toBeInTheDocument()
  })

  it('renders nothing on mobile until opened, then closes on navigation', () => {
    const onCloseMobile = vi.fn()
    const closed = renderAdmin(<Sidebar {...base} isMobile />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    closed.unmount()
    renderAdmin(<Sidebar {...base} isMobile mobileOpen onCloseMobile={onCloseMobile} />)
    fireEvent.click(screen.getByRole('link', { name: /Posts/ }))
    expect(onCloseMobile).toHaveBeenCalled()
  })

  it('signs out from the account block', () => {
    const { container } = renderAdmin(<Sidebar {...base} />)
    expect(container).toHaveTextContent('Admin')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
