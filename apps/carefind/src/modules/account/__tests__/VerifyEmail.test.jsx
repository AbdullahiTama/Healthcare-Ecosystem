import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import VerifyEmail, { SETTLE_TIMEOUT_MS, __resetVerifyEmailForTests } from '../VerifyEmail.jsx'

// ── Supabase client mock ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const listeners = new Set()
  const unsub = vi.fn()
  return {
    listeners,
    unsub,
    supabase: {
      auth: {
        exchangeCodeForSession: vi.fn(),
        getSession: vi.fn(),
        onAuthStateChange: vi.fn((cb) => {
          listeners.add(cb)
          return { data: { subscription: { unsubscribe: unsub } } }
        }),
      },
    },
  }
})

vi.mock('../../../config/supabaseClient', () => ({ supabase: mocks.supabase }))

// ── Import-time capture mock ────────────────────────────────────────────────
// `captureState` is the single object exposed as `capturedVerifyEmailParams`,
// so the page reads its properties at effect time and per-test mutations are
// visible through the live binding. `setCapture` rewrites it in beforeEach.
const captureState = vi.hoisted(() => ({
  code: null,
  accessToken: null,
  type: null,
  error: null,
  errorDescription: null,
}))

vi.mock('../verifyEmailParams', () => ({
  parseVerifyEmailParams: () => captureState,
  capturedVerifyEmailParams: captureState,
}))

function setCapture(overrides = {}) {
  Object.assign(captureState, {
    code: null,
    accessToken: null,
    type: null,
    error: null,
    errorDescription: null,
    ...overrides,
  })
}

function emit(event, session) {
  mocks.listeners.forEach((cb) => cb(event, session))
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/onboarding" element={<div>ONBOARDING</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('VerifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    __resetVerifyEmailForTests()
    setCapture()
    window.history.replaceState(null, '', '/verify-email')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('PKCE success settles verified from the exchange result, never a re-getSession', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(mocks.supabase.auth.exchangeCodeForSession.mock.calls[0][0].startsWith(window.location.origin)).toBe(true)
    expect(mocks.supabase.auth.exchangeCodeForSession.mock.calls[0][0]).toContain('/verify-email?code=abc123')
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('exchange error settles expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid code' } })
    setCapture({ code: 'bad' })
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Verification link expired')
  })

  it('exchange rejection settles expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    setCapture({ code: 'bad' })
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('auto-handled PKCE: an arriving session settles verified with no re-exchange', async () => {
    setCapture({ code: 'handled' })
    // The client consumed the code at boot — it is gone from the URL.
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'whatever' }))

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('auto-handled PKCE with no stored session expires', async () => {
    setCapture({ code: 'handled' })
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('captured error/error_description settles expired without touching supabase', async () => {
    setCapture({ accessToken: 'tok', type: 'signup', error: 'access_denied', errorDescription: 'The link you used is invalid or has expired.' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup&error=access_denied&error_description=bad')

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Email verified')).toBeNull()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('an already-verified user clicking a fresh valid PKCE link still sees verified (stored session never blocks)', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'stored', user: { id: 'u1' } } }, error: null })
    setCapture({ code: 'fresh' })
    window.history.replaceState(null, '', '/verify-email?code=fresh')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('no-token capture renders info even while a session is mocked in storage', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('non-signup hash type with an access_token shape does not fake success', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
    setCapture({ accessToken: 'tok', type: 'recovery' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=recovery')

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('implicit success via an arriving matching-session event', async () => {
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
  })

  it('settles verified from an arriving session event even when the hash was already cleared at boot', async () => {
    // Capture holds the token while the URL no longer does (supabase stripped it).
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
  })

  it('implicit success via the single gated getSession when the token matches', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).toHaveBeenCalledTimes(1)
  })

  it('a non-matching stored session never flips an implicit hash to verified', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'other', user: { id: 'u1' } } }, error: null })
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('a listener-emitted session on a tokenless page stays info', async () => {
    renderPage()
    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(screen.getByText('Missing verification link')).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('a listener-emitted session on a failed page stays expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    setCapture({ code: 'bad' })
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('implicit hash with no session event expires via the bounded timer', () => {
    vi.useFakeTimers()
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(SETTLE_TIMEOUT_MS) })

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('hung exchangeCodeForSession expires via the bounded timer', () => {
    vi.useFakeTimers()
    mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise(() => {}))
    setCapture({ code: 'pending' })
    window.history.replaceState(null, '', '/verify-email?code=pending')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(SETTLE_TIMEOUT_MS) })

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('implicit-hash null session after resolution settles expired', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('unmounting mid-exchange causes no crash and no late settle', async () => {
    let resolveExchange
    mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise((r) => { resolveExchange = r }))
    setCapture({ code: 'pending' })
    window.history.replaceState(null, '', '/verify-email?code=pending')

    const { unmount } = renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    unmount()

    await act(async () => { resolveExchange({ data: { session: { user: { id: 'u1' } } }, error: null }) })
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('expired copy does not promise a resend path', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    setCapture({ code: 'bad' })
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('log in')
    expect(alert).toHaveTextContent('support')
    expect(alert.textContent).not.toMatch(/resend/i)
    expect(alert.textContent).not.toMatch(/sign up again/i)
  })

  it('verified card exposes a single primary CTA to /onboarding', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    renderPage()
    await screen.findByText('Email verified')

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Continue to onboarding')
  })

  it('verified CTA navigates to /onboarding', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    renderPage()
    fireEvent.click(await screen.findByText('Continue to onboarding'))

    expect(screen.getByText('ONBOARDING')).toBeInTheDocument()
  })

  it('expired CTA navigates to /login', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    setCapture({ code: 'bad' })
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to login' }))

    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('info CTA navigates to /login', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to login' }))

    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('unmount unsubscribes the auth listener', () => {
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    const { unmount } = renderPage()
    expect(mocks.listeners.size).toBeGreaterThan(0)

    unmount()

    expect(mocks.unsub).toHaveBeenCalled()
  })

  it('settles to info synchronously for a bare non-signup type', async () => {
    setCapture({ accessToken: 'tok', type: 'magiclink' })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=magiclink')

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
  })

  it('strips the consumed code/hash after verified', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    const { unmount } = renderPage()
    await screen.findByText('Email verified')

    expect(window.location.href).not.toMatch(/[?&]code=/)
    unmount()
  })

  it('post-verified: a fresh tokenless page renders info, not expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    const { unmount } = renderPage()
    await screen.findByText('Email verified')
    unmount()

    // Fresh page load: capture is empty again and the URL has no token.
    __resetVerifyEmailForTests()
    setCapture()
    window.history.replaceState(null, '', '/verify-email')

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('StrictMode double-invoke never flips a settled verified to expired', async () => {
    let resolveFirst
    let resolveSecond
    mocks.supabase.auth.exchangeCodeForSession
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r }))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r }))
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/verify-email']}>
          <Routes>
            <Route path="/verify-email" element={<VerifyEmail />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>
    )

    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(2)

    await act(async () => { resolveFirst({ data: { session: { user: { id: 'u1' } } }, error: null }) })
    expect(await screen.findByText('Email verified')).toBeInTheDocument()

    await act(async () => { resolveSecond({ data: { session: null }, error: { message: 'code already used' } }) })

    expect(screen.getByText('Email verified')).toBeInTheDocument()
    expect(screen.queryByText('Verification link expired')).toBeNull()
  })
})