import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { supabase, callAdminAuth, navigate } = vi.hoisted(() => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
  callAdminAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../../config/supabaseClient', () => ({ supabase }))
vi.mock('./adminApi', () => ({ callAdminAuth }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

import AdminLogin from './AdminLogin'

function renderLogin() {
  return render(
    <MemoryRouter>
      <AdminLogin />
    </MemoryRouter>,
  )
}

describe('AdminLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'signed-supabase-access-token' } },
      error: null,
    })
    supabase.auth.signOut.mockResolvedValue({ error: null })
    callAdminAuth.mockResolvedValue({
      admin: { id: 'admin-7', email: 'admin@example.com', role: 'moderator' },
      permissions: { news: true },
    })
  })

  it('verifies the Supabase session and uses the database-backed admin response', async () => {
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText('admin@carefind.ng'), {
      target: { value: 'Admin@Example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'correct-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin-panel'))
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'correct-password',
    })
    expect(callAdminAuth).toHaveBeenCalledWith('verify')
    expect(localStorage.getItem('admin_user')).toContain('"role":"moderator"')
    expect(localStorage.getItem('admin_token')).toBeNull()
  })

  it('signs out and clears cached admin state when server verification denies access', async () => {
    localStorage.setItem('admin_user', JSON.stringify({ id: 'forged-admin', role: 'super_admin' }))
    localStorage.setItem('admin_permissions', JSON.stringify({ all: true }))
    localStorage.setItem('admin_token', 'forged-base64-token')
    callAdminAuth.mockRejectedValue(new Error('Active admin access required'))

    renderLogin()
    fireEvent.change(screen.getByPlaceholderText('admin@carefind.ng'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'valid-user-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Active admin access required')).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(localStorage.getItem('admin_user')).toBeNull()
    expect(localStorage.getItem('admin_permissions')).toBeNull()
    expect(localStorage.getItem('admin_token')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('clears any prior session and admin cache after a failed password login', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: new Error('Invalid credentials'),
    })
    localStorage.setItem('admin_user', JSON.stringify({ id: 'stale-admin' }))
    localStorage.setItem('admin_permissions', JSON.stringify({ all: true }))

    renderLogin()
    fireEvent.change(screen.getByPlaceholderText('admin@carefind.ng'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrong-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Incorrect email or password. Please try again.')).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(localStorage.getItem('admin_user')).toBeNull()
    expect(localStorage.getItem('admin_permissions')).toBeNull()
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
})
