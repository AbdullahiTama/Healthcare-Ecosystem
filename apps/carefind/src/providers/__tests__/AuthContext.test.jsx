import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../AuthContext.jsx'

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  updateUser: vi.fn(),
}))

vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: authMock } }))

function Harness({ email, metadata }) {
  const { signUp } = useAuth()
  return (
    <button type="button" onClick={() => signUp(email, 'password123', metadata)}>
      sign up
    </button>
  )
}

const fetchMock = vi.hoisted(() => vi.fn())

function renderHarness(email, metadata) {
  return render(
    <AuthProvider>
      <Harness email={email} metadata={metadata} />
    </AuthProvider>
  )
}

function fetchBodies() {
  return fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body) }))
}

describe('AuthContext redirectTo wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    global.fetch = fetchMock.mockResolvedValue({ ok: true })
    authMock.getSession.mockResolvedValue({ data: { session: null }, error: null })
  })

  afterEach(() => {
    delete global.fetch
  })

  it('posts email_verification with redirectTo ending /verify-email when confirmation is required', async () => {
    authMock.signUp.mockResolvedValue({ data: { session: null }, error: null })

    renderHarness('new@carefind.app', { full_name: 'New User' })
    fireEvent.click(screen.getByText('sign up'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const bodies = fetchBodies()
    const ev = bodies.find((b) => b.body.action === 'email_verification')
    const cr = bodies.find((b) => b.body.action === 'customer_registration')

    expect(ev.url).toBe('/api/auth-email')
    expect(ev.body.email).toBe('new@carefind.app')
    expect(typeof ev.body.redirectTo).toBe('string')
    expect(ev.body.redirectTo.endsWith('/verify-email')).toBe(true)

    expect(cr.url).toBe('/api/auth-email')
    expect(cr.body.redirectTo).toBeUndefined()
  })

  it('derives redirectTo from the current origin rather than a hardcoded host', async () => {
    authMock.signUp.mockResolvedValue({ data: { session: null }, error: null })

    renderHarness('a@carefind.app', { full_name: 'A' })
    fireEvent.click(screen.getByText('sign up'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const ev = fetchBodies().find((b) => b.body.action === 'email_verification')
    expect(ev.body.redirectTo).toBe(`${window.location.origin}/verify-email`)
  })

  it('does not send email_verification when signup returns a session', async () => {
    authMock.signUp.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })

    renderHarness('session@carefind.app', { full_name: 'S' })
    fireEvent.click(screen.getByText('sign up'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const actions = fetchBodies().map((b) => b.body.action)
    expect(actions).toEqual(['customer_registration'])
  })
})