import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), navigate: vi.fn() }))
vi.mock('../../../providers/AuthContext', () => ({
  useAuth: () => ({ signUp: (...a) => h.signUp(...a), signIn: (...a) => h.signIn(...a) }),
}))
vi.mock('../../../config/supabaseClient', () => ({ supabase: { rpc: vi.fn(), auth: {} } }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => h.navigate,
}))

import Login from '../Login.jsx'

// Signup is a toggle on the login page (isSignUp is local state), so drive it
// the way a user does: switch to Sign Up, fill the form, submit.
async function submitSignup() {
  render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'tola@x.test' } })
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'secret12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
  await screen.findByText(/confirm your email/i)
}

beforeEach(() => {
  h.signUp.mockReset()
  h.signIn.mockReset()
  h.navigate.mockReset()
  h.signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CareFind signup before confirmation', () => {
  it('shows the inbox state, not the app, when Supabase returns no session', async () => {
    await submitSignup()
    expect(screen.getByText(/we sent a confirmation link/i)).toBeTruthy()
    expect(h.signUp).toHaveBeenCalledTimes(1)
    expect(h.navigate).not.toHaveBeenCalled()
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('resends the verification link through the rate-limited endpoint', async () => {
    await submitSignup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    fireEvent.click(screen.getByRole('button', { name: /resend/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth-email')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'email_verification',
      email: 'tola@x.test',
      redirectTo: `${window.location.origin}/verify-email`,
    })
    expect(await screen.findByText(/new link is on its way/i)).toBeTruthy()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('shows the same confirmation when the request fails, and locks the control for 60 seconds', async () => {
    await submitSignup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    vi.useFakeTimers()
    const resend = screen.getByRole('button', { name: /resend/i })
    await act(async () => { fireEvent.click(resend) })
    expect(screen.getByText(/new link is on its way/i)).toBeTruthy()
    const locked = screen.getByRole('button', { name: /resend/i })
    expect(locked.disabled).toBe(true)
    fireEvent.click(locked)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(59_000) })
    expect(screen.getByRole('button', { name: /resend/i }).disabled).toBe(true)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByRole('button', { name: /resend/i }).disabled).toBe(false)
  })
})
