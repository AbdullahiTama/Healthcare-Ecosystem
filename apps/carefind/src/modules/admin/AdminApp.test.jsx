import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { renderWithQueryClient } from '../../test/renderWithQueryClient.jsx'

const { supabase, callAdminAuth } = vi.hoisted(() => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  callAdminAuth: vi.fn(),
}))
vi.mock('../../config/supabaseClient', () => ({ supabase }))
vi.mock('./adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))
vi.mock('./hooks/useRealtimeChannel', () => ({ useRealtimeChannel: () => {} }))
vi.mock('./AdminAiCopilot.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/Logo', () => ({ default: () => <span>logo</span> }))
vi.mock('./legacy/LegacyScreens.jsx', () => ({ default: ({ tab }) => <div>legacy:{tab}</div> }))
vi.mock('../agents-hub/AgentApproval.jsx', () => ({ default: () => <div>agent approval page</div> }))
vi.mock('../agents-hub/AgentEarnings.jsx', () => ({ default: () => <div>agent earnings page</div> }))
vi.mock('../agents-hub/AgentTransfer.jsx', () => ({ default: () => <div>agent transfer page</div> }))
vi.mock('../businesses-hub/BusinessesHub.jsx', () => ({ default: () => <div>business hub page</div> }))
vi.mock('../business-directory/BusinessDirectoryPage', () => ({ default: () => <div>directory manager page</div> }))

import AdminApp from './AdminApp.jsx'
import { isAdminPath } from './navigation'

// Mirrors main.jsx: admin paths go to AdminApp, everything else is "outside".
function Root() {
  const location = useLocation()
  return isAdminPath(location.pathname) ? <AdminApp /> : <div>outside:{location.pathname}</div>
}
const renderAt = (route) => renderWithQueryClient(<MemoryRouter initialEntries={[route]}><Root /></MemoryRouter>)

function signInAs(admin, permissions = {}) {
  callAdminAuth.mockImplementation(async (action) => {
    if (action === 'verify') return { admin, permissions }
    return { data: [] }
  })
}

describe('AdminApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Desktop width: the sidebar's collapse control only exists above tablet.
    window.innerWidth = 1440
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    supabase.auth.signOut.mockResolvedValue({ error: null })
    signInAs({ id: 'a1', full_name: 'Ada', role: 'super_admin' })
  })

  it('sends a signed-out visitor to login', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderAt('/admin/moderation/reports')
    expect(await screen.findByText('outside:/login')).toBeInTheDocument()
  })

  it('renders an unmigrated screen through the legacy adapter', async () => {
    renderAt('/admin/content/news')
    expect(await screen.findByText('legacy:news')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument()
  })

  it.each([
    ['/admin-panel', 'legacy:overview'],
    ['/admin/dashboard', 'legacy:overview'],
    ['/admin/businesses', 'business hub page'],
    ['/admin/agents', 'agent approval page'],
    ['/admin/applications', 'agent approval page'],
    ['/admin/earnings', 'agent earnings page'],
    ['/admin/transfers', 'agent transfer page'],
    ['/business-directory', 'directory manager page'],
    ['/agents/approval', 'agent approval page'],
    ['/agents/earnings', 'agent earnings page'],
    ['/agents/transfer', 'agent transfer page'],
  ])('redirects the legacy address %s', async (from, text) => {
    renderAt(from)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('keeps the query string when redirecting a legacy address', async () => {
    function Where() { const l = useLocation(); return <span>at:{l.pathname}{l.search}</span> }
    renderWithQueryClient(<MemoryRouter initialEntries={['/admin/businesses?id=b7']}><Root /><Where /></MemoryRouter>)
    expect(await screen.findByText('at:/admin/directory/business-hub?id=b7')).toBeInTheDocument()
  })

  it('shows the alerts page from the bell address', async () => {
    renderAt('/admin/alerts')
    expect(await screen.findByText('legacy:notifications')).toBeInTheDocument()
  })

  it('shows no-access for a screen the role may not open, and never renders it', async () => {
    signInAs({ id: 'm', full_name: 'Mo', role: 'moderator' }, { users: false })
    renderAt('/admin/community/users')
    expect(await screen.findByText("You don't have access to this screen")).toBeInTheDocument()
    expect(screen.queryByText('legacy:users')).not.toBeInTheDocument()
  })

  it('denies the new agent screens to a restricted role by default', async () => {
    signInAs({ id: 'm', full_name: 'Mo', role: 'moderator' }, {})
    renderAt('/admin/agents/transfers')
    expect(await screen.findByText("You don't have access to this screen")).toBeInTheDocument()
    expect(screen.queryByText('agent transfer page')).not.toBeInTheDocument()
  })

  it('sends a role without the overview permission to its first permitted screen', async () => {
    // The Moderation screens leave the legacy adapter later in this plan, so
    // this role is denied them too and its first permitted screen is Posts.
    signInAs({ id: 'm', full_name: 'Mo', role: 'moderator' },
      { overview: false, moderation: false, reports: false, verifications: false, claims: false })
    renderAt('/admin')
    expect(await screen.findByText('legacy:posts')).toBeInTheDocument()
  })

  it('shows a not-found state for an unknown admin address', async () => {
    renderAt('/admin/nope/nothing')
    expect(await screen.findByText('This admin page does not exist')).toBeInTheDocument()
  })

  it('does not re-verify or remount the shell when moving between screens', async () => {
    renderAt('/admin/content/news')
    await screen.findByText('legacy:news')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Posts' }))
    expect(await screen.findByText('legacy:posts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(callAdminAuth.mock.calls.filter(c => c[0] === 'verify')).toHaveLength(1)
  })

  it('returns to login when the session expires on an open screen', async () => {
    renderAt('/admin/content/news')
    await screen.findByText('legacy:news')
    window.dispatchEvent(new CustomEvent('admin:session-expired'))
    await waitFor(() => expect(screen.getByText('outside:/login')).toBeInTheDocument())
  })
})
