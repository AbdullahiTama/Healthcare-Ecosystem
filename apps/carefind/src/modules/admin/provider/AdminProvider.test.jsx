import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../../test/renderWithQueryClient.jsx'

const navigate = vi.hoisted(() => vi.fn())
const supa = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), signOut: vi.fn() },
}))
const api = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../../../config/supabaseClient', () => ({ supabase: supa }))
vi.mock('../adminApi', () => api)
vi.mock('../hooks/useRealtimeChannel', () => ({ useRealtimeChannel: vi.fn() }))

import { AdminProvider, useAdmin } from './AdminProvider.jsx'

function Probe() {
  const { adminUser, permissions, signOut, askConfirm, recordAction, actionHistory } = useAdmin()
  return (
    <div>
      <span>user:{adminUser.full_name}</span>
      <span>perm:{JSON.stringify(permissions)}</span>
      <span>history:{actionHistory.length}</span>
      <button onClick={signOut}>sign out</button>
      <button onClick={() => askConfirm({ title: 'Delete it?', consequence: 'Gone for good.', action: () => recordAction({ action: 'delete' }) })}>ask</button>
    </div>
  )
}

const mount = () => render(<AdminProvider><Probe /></AdminProvider>)

beforeEach(() => {
  localStorage.clear()
  navigate.mockReset()
  supa.auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
  supa.auth.signOut.mockReset().mockResolvedValue({})
  api.callAdminAuth.mockReset().mockImplementation(async (action) => {
    if (action === 'verify') return { admin: { id: 'a1', full_name: 'Ada Admin', role: 'moderator' }, permissions: { finance: false } }
    return {}
  })
})

describe('AdminProvider', () => {
  it('verifies the session with the server and exposes the admin and permissions', async () => {
    mount()
    expect(await screen.findByText('user:Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('perm:{"finance":false}')).toBeInTheDocument()
    expect(api.callAdminAuth).toHaveBeenCalledWith('verify')
    expect(JSON.parse(localStorage.getItem('admin_user')).id).toBe('a1')
  })

  it('renders nothing of the admin and goes to login when there is no session', async () => {
    supa.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    localStorage.setItem('admin_user', '{"id":"stale"}')
    mount()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'))
    expect(screen.queryByText(/user:/)).not.toBeInTheDocument()
    expect(localStorage.getItem('admin_user')).toBeNull()
    expect(api.callAdminAuth).not.toHaveBeenCalledWith('verify')
  })

  it('signs out locally and goes to login when the server refuses the session', async () => {
    api.callAdminAuth.mockImplementation(async (action) => { if (action === 'verify') throw new Error('Unauthorized'); return {} })
    localStorage.setItem('admin_user', '{"id":"stale"}')
    mount()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'))
    expect(supa.auth.signOut).toHaveBeenCalled()
    expect(screen.queryByText(/user:/)).not.toBeInTheDocument()
    expect(localStorage.getItem('admin_user')).toBeNull()
  })

  it('does not trust a cached admin_user: access comes only from the verify response', async () => {
    localStorage.setItem('admin_user', JSON.stringify({ id: 'cached', full_name: 'Cached Super', role: 'super_admin' }))
    mount()
    expect(await screen.findByText('user:Ada Admin')).toBeInTheDocument()
    expect(screen.queryByText('user:Cached Super')).not.toBeInTheDocument()
  })

  it('sends one server logout even when sign out is pressed twice quickly', async () => {
    mount()
    const btn = await screen.findByRole('button', { name: 'sign out' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'))
    expect(api.callAdminAuth.mock.calls.filter(c => c[0] === 'logout')).toHaveLength(1)
    expect(supa.auth.signOut).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('admin_user')).toBeNull()
  })

  it('still signs out locally when the server logout fails', async () => {
    api.callAdminAuth.mockImplementation(async (action) => {
      if (action === 'verify') return { admin: { id: 'a1', full_name: 'Ada Admin' }, permissions: {} }
      throw new Error('network')
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'))
    expect(supa.auth.signOut).toHaveBeenCalled()
  })

  it('runs a confirmed action only after the admin confirms, and states the consequence', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'ask' }))
    expect(await screen.findByText('Gone for good.')).toBeInTheDocument()
    expect(screen.getByText('history:0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('history:1')).toBeInTheDocument())
  })
})
