import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { supabase, callAdminAuth } = vi.hoisted(() => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn() } },
  callAdminAuth: vi.fn(),
}))
vi.mock('../../config/supabaseClient', () => ({ supabase }))
vi.mock('./adminApi', () => ({ callAdminAuth, SESSION_EXPIRED_EVENT: 'admin:session-expired' }))

import { AdminGate, useAdmin } from './AdminGate.jsx'

function Inside() {
  const { adminUser, permissions, signOut } = useAdmin()
  return (
    <div>
      <span>hello {adminUser.full_name}</span>
      <span>news:{String(permissions.news)}</span>
      <button onClick={signOut}>out</button>
    </div>
  )
}

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminGate><Inside /></AdminGate>} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    supabase.auth.signOut.mockResolvedValue({ error: null })
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'verify') return { admin: { id: 'a1', full_name: 'Ada', role: 'moderator' }, permissions: { news: true } }
      return {}
    })
  })

  it('renders children with the verified admin and permissions', async () => {
    renderGate()
    expect(await screen.findByText('hello Ada')).toBeInTheDocument()
    expect(screen.getByText('news:true')).toBeInTheDocument()
    expect(callAdminAuth).toHaveBeenCalledWith('verify')
  })

  it('renders nothing protected while checking', () => {
    callAdminAuth.mockReturnValue(new Promise(() => {}))
    renderGate()
    expect(screen.queryByText(/hello/)).not.toBeInTheDocument()
  })

  it('goes to login without calling verify when there is no session', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderGate()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(callAdminAuth).not.toHaveBeenCalledWith('verify')
  })

  it('signs out and goes to login when verify is rejected', async () => {
    callAdminAuth.mockRejectedValue(new Error('not an admin'))
    localStorage.setItem('admin_user', '{"id":"stale"}')
    renderGate()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(localStorage.getItem('admin_user')).toBeNull()
    expect(localStorage.getItem('admin_permissions')).toBeNull()
  })

  it('goes to login when verify returns no admin id', async () => {
    callAdminAuth.mockResolvedValue({ admin: {}, permissions: {} })
    renderGate()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('goes to login when a later call reports an expired session', async () => {
    renderGate()
    await screen.findByText('hello Ada')
    act(() => { window.dispatchEvent(new CustomEvent('admin:session-expired')) })
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
  })

  it('ignores a late verify result once an expiry has begun leaving', async () => {
    let resolveVerify
    callAdminAuth.mockImplementation((action) => {
      if (action === 'verify') return new Promise((resolve) => { resolveVerify = resolve })
      return Promise.resolve({})
    })
    renderGate()
    await waitFor(() => expect(callAdminAuth).toHaveBeenCalledWith('verify'))
    act(() => { window.dispatchEvent(new CustomEvent('admin:session-expired')) })
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    await act(async () => {
      resolveVerify({ admin: { id: 'a1', full_name: 'Ada', role: 'moderator' }, permissions: { news: true } })
    })
    expect(screen.queryByText(/hello/)).not.toBeInTheDocument()
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
    expect(localStorage.getItem('admin_user')).toBeNull()
    expect(localStorage.getItem('admin_permissions')).toBeNull()
  })

  it('signOut logs out on the server, clears the cache and goes to login', async () => {
    renderGate()
    ;(await screen.findByText('out')).click()
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    await waitFor(() => expect(callAdminAuth).toHaveBeenCalledWith('logout'))
    expect(supabase.auth.signOut).toHaveBeenCalled()
  })
})
