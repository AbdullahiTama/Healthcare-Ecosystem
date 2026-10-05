import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('../adminApi', () => ({ callAdminAuth: vi.fn(), SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { renderAdmin } from '../test/renderAdmin.jsx'
import TopBar from './TopBar.jsx'

describe('TopBar', () => {
  it('opens search and links to alerts with the pending total', () => {
    const onOpenSearch = vi.fn()
    renderAdmin(<TopBar isMobile={false} onOpenMenu={() => {}} onOpenSearch={onOpenSearch} alertsCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(onOpenSearch).toHaveBeenCalled()
    const bell = screen.getByRole('link', { name: 'Alerts, 2 pending' })
    expect(bell).toHaveAttribute('href', '/admin/alerts')
    expect(bell).toHaveTextContent('2')
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument()
  })

  it('shows the menu button on mobile and no badge at zero', () => {
    const onOpenMenu = vi.fn()
    renderAdmin(<TopBar isMobile onOpenMenu={onOpenMenu} onOpenSearch={() => {}} alertsCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(onOpenMenu).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
  })

  it('hides the bell from a role without the alerts permission', () => {
    renderAdmin(<TopBar isMobile={false} onOpenMenu={() => {}} onOpenSearch={() => {}} alertsCount={5} />,
      { admin: { id: 'm', role: 'moderator' }, permissions: { notifications: false } })
    expect(screen.queryByRole('link', { name: /Alerts/ })).not.toBeInTheDocument()
  })
})
