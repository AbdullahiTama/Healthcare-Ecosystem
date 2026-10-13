import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const hook = vi.hoisted(() => ({ value: null, refetch: vi.fn(), permissions: {} }))
vi.mock('../hooks/useAlerts', () => ({ useAlerts: () => ({ ...hook.value, refetch: hook.refetch }) }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => ({ permissions: hook.permissions }) }))

import AlertsSection from './AlertsSection.jsx'

const MARKUP = '<img src=x onerror=alert(1)>'
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString()
const alert = (id, type, severity, tab, extra = {}) => ({
  id, type, severity, tab, role: 'super_admin', icon: 'x', title: `Title ${id}`, subtitle: `Sub ${id}`, time: ago(2), ...extra,
})
const alerts = [
  alert('a1', 'report', 'urgent', 'reports'),
  alert('a2', 'withdrawal', 'warning', 'withdrawals'),
  alert('a3', 'task', 'info', 'tasks'),
]
const setHook = (v) => { hook.value = { data: { alerts, failed: [] }, isLoading: false, isError: false, ...v } }

beforeEach(() => {
  hook.refetch.mockReset()
  hook.permissions = {}
  setHook({})
})

describe('AlertsSection', () => {
  it('shows a loading placeholder, never all clear', () => {
    setHook({ data: undefined, isLoading: true })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Checking/)
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
  })

  it('says it could not check at all, with Retry, never all clear', () => {
    setHook({ data: undefined, isError: true })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByText(/Couldn't check alerts/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(hook.refetch).toHaveBeenCalled()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
  })

  it('names failed sources in an alert banner and never says all clear', () => {
    setHook({ data: { alerts: [], failed: ['Withdrawals', 'News'] } })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't check: Withdrawals, News")
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    expect(hook.refetch).toHaveBeenCalled()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
    expect(screen.getByText('Nothing pending in the sources that loaded')).toBeInTheDocument()
  })

  it('never says all clear; with nothing pending and nothing failed it says what was checked', () => {
    setHook({ data: { alerts: [], failed: [] } })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByText('Nothing pending in the sources checked')).toBeInTheDocument()
    expect(screen.getByText("Some reads can't report their own failures; this reflects what the server returned.")).toBeInTheDocument()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('groups alerts under Urgent, Warning and Info, skipping empty groups', () => {
    setHook({ data: { alerts: [alerts[0], alerts[2]], failed: [] } })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Urgent' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Info' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Warning' })).not.toBeInTheDocument()
  })

  it('shows title, subtitle, relative time and severity on each card', () => {
    render(<AlertsSection onOpenTab={() => {}} />)
    const card = screen.getByRole('button', { name: /Title a1/ })
    expect(within(card).getByText('Title a1')).toBeInTheDocument()
    expect(within(card).getByText('Sub a1')).toBeInTheDocument()
    expect(within(card).getByText('2h ago')).toBeInTheDocument()
    expect(within(card).getByText('Urgent')).toBeInTheDocument()
  })

  it('opens the tab for a card the role may open', () => {
    const onOpenTab = vi.fn()
    render(<AlertsSection onOpenTab={onOpenTab} />)
    fireEvent.click(screen.getByRole('button', { name: /Title a2/ }))
    expect(onOpenTab).toHaveBeenCalledWith('withdrawals')
  })

  it('shows a card without an action when the role may not open its tab', () => {
    hook.permissions = { withdrawals: false }
    const onOpenTab = vi.fn()
    render(<AlertsSection onOpenTab={onOpenTab} />)
    expect(screen.getByText('Title a2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Title a2/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Not available to your role')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Title a1/ })).toBeInTheDocument()
  })

  it('shows the banner and the alerts together when only some sources failed', () => {
    setHook({ data: { alerts, failed: ['News'] } })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't check: News")
    expect(screen.getByText('Title a1')).toBeInTheDocument()
    expect(screen.queryByText('Nothing pending in the sources that loaded')).not.toBeInTheDocument()
  })

  it('renders markup in titles and subtitles as inert text', () => {
    setHook({ data: { alerts: [alert('m1', 'report', 'urgent', 'reports', { title: MARKUP, subtitle: MARKUP })], failed: [] } })
    const { container } = render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getAllByText(MARKUP)).toHaveLength(2)
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps loaded alerts and says so when a refresh fails', () => {
    setHook({ isError: true })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh, showing the last loaded data.")
    expect(screen.getByText('Title a1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry refreshing alerts' }))
    expect(hook.refetch).toHaveBeenCalled()
  })

  it('does not show the refresh note when there is no data at all', () => {
    setHook({ data: undefined, isError: true })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.queryByText(/showing the last loaded data/)).not.toBeInTheDocument()
  })

  it('files an unknown severity under Info', () => {
    setHook({ data: { alerts: [alert('u1', 'report', 'critical', 'reports')], failed: [] } })
    render(<AlertsSection onOpenTab={() => {}} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Info' })).toBeInTheDocument()
  })

  it('opens overview for a consultation alert', () => {
    const onOpenTab = vi.fn()
    setHook({ data: { alerts: [alert('c1', 'consultation', 'info', 'overview')], failed: [] } })
    render(<AlertsSection onOpenTab={onOpenTab} />)
    fireEvent.click(screen.getByRole('button', { name: /Title c1/ }))
    expect(onOpenTab).toHaveBeenCalledWith('overview')
  })

  it('disables Retry and says Checking while a re-check runs', () => {
    setHook({ data: { alerts: [], failed: ['News'] }, isFetching: true })
    render(<AlertsSection onOpenTab={() => {}} />)
    const btn = within(screen.getByRole('alert')).getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Checking…')
    expect(btn.textContent).not.toContain(String.fromCharCode(0xfffd))
  })
})
