import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
// The visit judge (`judgedSnapshots`) lives at module scope inside the page.
// Tests therefore reload a FRESH module instance per test / visit via
// `vi.resetModules()` + dynamic import -- the page avoids a production test
// hook (KEEP: "no prod test hook").
const moduleHolder = vi.hoisted(() => ({ mod: null }))
async function loadPageModule() {
  vi.resetModules()
  moduleHolder.mod = await import('../VerifyEmail.jsx')
  return moduleHolder.mod
}

// Real supabase callback shapes (xii): auth-js REQUIRES all four explicit
// params in an implicit callback or it throws "No session defined in URL", so
// a minted signup link always carries them. `#access_token=tok&type=signup`
// alone is a shape auth-js rejects and must not be the only branch-3 fixture.
const IMPLICIT_CALLBACK_HASH = '#access_token=tok&expires_in=3600&refresh_token=rt&token_type=bearer&type=signup'
const ORIGIN = 'http://localhost:3000'

	// ---- Supabase client mock ----
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

	// ---- Import-time capture mock ----
// `captureState` is the single object exposed as `capturedVerifyEmailParams`,
// so the page reads its properties at effect time and per-test mutations are
// visible through the live binding. `setCapture` rewrites it in beforeEach.
// The mock keeps the module's REAL `consumedUrlFromHref` / `currentUrlHref` so
// tests exercise the genuine consumption-shape derivation, then overrides only
// the snapshot object and its parser.
const captureState = vi.hoisted(() => ({
  href: null,
  code: null,
  hasCode: false,
  accessToken: null,
  hasAccessToken: false,
  type: null,
  hasType: false,
  error: null,
  hasError: false,
  errorDescription: null,
  hasErrorDescription: false,
}))

vi.mock('../verifyEmailParams', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    parseVerifyEmailParams: () => captureState,
    capturedVerifyEmailParams: captureState,
  }
})

// Presence booleans auto-derive from a non-null value, unless overridden
// (empty-param tests need `present` with a null value).
function setCapture(overrides = {}) {
  Object.assign(captureState, {
    href: window.location.href,
    code: null,
    accessToken: null,
    type: null,
    error: null,
    errorDescription: null,
    ...overrides,
  })
  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasCode')) captureState.hasCode = captureState.code !== null
  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasAccessToken')) captureState.hasAccessToken = captureState.accessToken !== null
  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasType')) captureState.hasType = captureState.type !== null
  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasError')) captureState.hasError = captureState.error !== null
  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasErrorDescription')) captureState.hasErrorDescription = captureState.errorDescription !== null
}

function emit(event, session) {
  mocks.listeners.forEach((cb) => cb(event, session))
}

function renderPage() {
  const VerifyEmail = moduleHolder.mod.default
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
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    await loadPageModule()
    window.history.replaceState(null, '', '/verify-email')
    setCapture()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('PKCE success settles verified from the exchange result, never a re-getSession', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(mocks.supabase.auth.exchangeCodeForSession.mock.calls[0][0].startsWith(window.location.origin)).toBe(true)
    expect(mocks.supabase.auth.exchangeCodeForSession.mock.calls[0][0]).toContain('/verify-email?code=abc123')
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('exchange error settles expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid code' } })
    window.history.replaceState(null, '', '/verify-email?code=bad')
    setCapture({ code: 'bad' })

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Verification link expired')
  })

  it('exchange rejection settles expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    window.history.replaceState(null, '', '/verify-email?code=bad')
    setCapture({ code: 'bad' })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  // (xiv) PKCE boot-consumption race (+ xviii): capture with `?code=`, the
  // client clears it before the effect (models `_getSessionFromURL` stripping
  // only `code` + `sb_flow_id`), and the page replays the visit record as
  // verified -- no re-exchange, no `getSession`, no stored session needed.
  it('boot-consumed PKCE link settles verified from the visit record, no re-exchange', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', '/verify-email?code=handled')
    setCapture({ code: 'handled' })
    window.history.replaceState(null, '', '/verify-email')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()

    const record = moduleHolder.mod.getVerifyEmailVisitRecord()
    expect(record).not.toBeNull()
    expect(record.verdict).toBe('verified')
    expect(new URL(record.snapshotUrl).searchParams.get('code')).toBe('handled')
    // PKCE consumed form strips ONLY `code` (+ `sb_flow_id`): bare URL recorded.
    expect(new URL(record.consumedUrl).search).toBe('')
    expect(record.consumedUrl).toBe(window.location.href)
  })

  it('captured error/error_description settles expired without touching supabase', async () => {
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup&error=access_denied&error_description=bad')
    setCapture({ accessToken: 'tok', type: 'signup', error: 'access_denied', errorDescription: 'The link you used is invalid or has expired.' })

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
    window.history.replaceState(null, '', '/verify-email?code=fresh')
    setCapture({ code: 'fresh' })

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
    window.history.replaceState(null, '', '/verify-email#access_token=tok&expires_in=3600&type=recovery')
    setCapture({ accessToken: 'tok', type: 'recovery' })

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('implicit success via an arriving matching-session event', async () => {
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  // (xiii) implicit boot-consumption race -- the iteration-4 bad_spec: capture
  // the full real callback hash, rewrite the URL to bare BEFORE the effect
  // runs (models `_initialize` clearing the whole hash), then assert the page
  // settles verified from the recorded visit -- with NO arriving event and NO
  // `getSession`. Direct regression for the false "Missing verification link".
  it('implicit boot-consumption race settles verified from the visit record, never "Missing verification link"', async () => {
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(screen.queryByText('Missing verification link')).toBeNull()
    expect(screen.queryByText('Verification link expired')).toBeNull()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()

    const record = moduleHolder.mod.getVerifyEmailVisitRecord()
    expect(record).not.toBeNull()
    expect(record.verdict).toBe('verified')
    expect(record.snapshotUrl).toContain('#access_token=tok')
    // Implicit consumed form drops the WHOLE hash: bare URL recorded.
    expect(new URL(record.consumedUrl).hash).toBe('')
    expect(record.consumedUrl).toBe(window.location.href)
  })

  it('implicit success via the single gated getSession when the token matches', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).toHaveBeenCalledTimes(1)
  })

  it('a non-matching stored session never flips an implicit hash to verified', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'other', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

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
    window.history.replaceState(null, '', '/verify-email?code=bad')
    setCapture({ code: 'bad' })

    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('implicit hash with no session event expires via the bounded timer', () => {
    vi.useFakeTimers()
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(moduleHolder.mod.SETTLE_TIMEOUT_MS) })

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('hung exchangeCodeForSession expires via the bounded timer', () => {
    vi.useFakeTimers()
    mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', '/verify-email?code=pending')
    setCapture({ code: 'pending' })

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(moduleHolder.mod.SETTLE_TIMEOUT_MS) })

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('implicit-hash null session after resolution settles expired', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('unmounting mid-exchange causes no crash and no late settle', async () => {
    let resolveExchange
    mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise((r) => { resolveExchange = r }))
    window.history.replaceState(null, '', '/verify-email?code=pending')
    setCapture({ code: 'pending' })

    const { unmount } = renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    unmount()

    await act(async () => { resolveExchange({ data: { session: { user: { id: 'u1' } } }, error: null }) })
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('expired copy does not promise a resend path', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    window.history.replaceState(null, '', '/verify-email?code=bad')
    setCapture({ code: 'bad' })

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('log in')
    expect(alert).toHaveTextContent('support')
    expect(alert.textContent).not.toMatch(/resend/i)
    expect(alert.textContent).not.toMatch(/sign up again/i)
  })

  it('verified card exposes a single primary CTA to /onboarding', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    renderPage()
    await screen.findByText('Email verified')

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Continue to onboarding')
  })

  it('verified CTA navigates to /onboarding', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    renderPage()
    fireEvent.click(await screen.findByText('Continue to onboarding'))

    expect(screen.getByText('ONBOARDING')).toBeInTheDocument()
  })

  it('expired CTA navigates to /login', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    window.history.replaceState(null, '', '/verify-email?code=bad')
    setCapture({ code: 'bad' })

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
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    const { unmount } = renderPage()
    expect(mocks.listeners.size).toBeGreaterThan(0)

    unmount()

    expect(mocks.unsub).toHaveBeenCalled()
  })

  it('settles to info synchronously for a bare non-signup type', async () => {
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=magiclink')
    setCapture({ accessToken: 'tok', type: 'magiclink' })

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
  })

  it('strips the consumed code/hash after verified', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    const { unmount } = renderPage()
    await screen.findByText('Email verified')

    expect(window.location.href).not.toMatch(/[?&]code=/)
    unmount()
  })

  it('post-verified: a fresh tokenless page renders info, not expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    const { unmount } = renderPage()
    await screen.findByText('Email verified')
    unmount()

    // Fresh page load: capture is empty again and the URL has no token.
    await loadPageModule()
    window.history.replaceState(null, '', '/verify-email')
    setCapture()

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
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/verify-email']}>
          <Routes>
            <Route path="/verify-email" element={React.createElement(moduleHolder.mod.default)} />
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

	  // ---- (xv) a11y ----

  it('a11y: a verified verdict focuses the result heading exactly once, with a visible focus indicator', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })

    renderPage()
    await screen.findByText('Email verified')

    const heading = screen.getByRole('heading', { level: 2, name: 'Email verified' })
    expect(document.activeElement).toBe(heading)
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading.style.outlineStyle).toBe('solid')
    expect(heading.style.outlineWidth).toBe('2px')
    expect(heading.style.outlineColor).toBe('var(--teal)')

    // Exactly ONE announce mechanism -- no live region stacked on the focus move.
    expect(document.querySelector('[aria-live]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    // Simulating a later re-render does not re-announce (focus moved once only).
    act(() => emit('SIGNED_IN', { access_token: 'other' }))
    expect(document.activeElement).toBe(heading)
  })

  it('a11y: an info verdict focuses its own heading and mounts no live region', async () => {
    renderPage()
    await screen.findByText('Missing verification link')

    const heading = screen.getByRole('heading', { level: 2, name: 'Missing verification link' })
    expect(document.activeElement).toBe(heading)
    expect(heading.style.outlineStyle).toBe('solid')
    expect(document.querySelector('[aria-live]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a11y: expired renders role=alert only, focuses nothing, and keeps controls outside the live region', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    window.history.replaceState(null, '', '/verify-email?code=bad')
    setCapture({ code: 'bad' })

    renderPage()
    const alert = await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: 'Back to login' })).toBeInTheDocument()
    expect(alert).not.toHaveAttribute('aria-live')
    expect(alert.querySelector('button')).toBeNull()
    expect(alert.querySelector('a')).toBeNull()

    const expiredHeading = screen.getByRole('heading', { level: 2, name: 'Verification link expired' })
    expect(document.activeElement).not.toBe(expiredHeading)
  })

	  // ---- (xvi) empty-param presence ----

  it('an empty ?code= (present but valueless) settles expired, not info', async () => {
    window.history.replaceState(null, '', '/verify-email?code=')
    setCapture({ code: null, hasCode: true })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Missing verification link')).toBeNull()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('an empty #access_token= (present but valueless) settles expired, not info', async () => {
    window.history.replaceState(null, '', '/verify-email#access_token=')
    setCapture({ accessToken: null, hasAccessToken: true })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Missing verification link')).toBeNull()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('an empty ?error= (present but valueless) settles expired, not info', async () => {
    window.history.replaceState(null, '', '/verify-email?error=')
    setCapture({ error: null, hasError: true })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Missing verification link')).toBeNull()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

	  // ---- (xviii) judged-URL bookkeeping ----

  it('a genuinely different token URL adjudicates fresh instead of replaying the last verdict', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })

    // First visit: PKCE token A, consumed at boot (only `code` stripped -> bare).
    window.history.replaceState(null, '', '/verify-email?code=aaa')
    setCapture({ code: 'aaa' })
    window.history.replaceState(null, '', '/verify-email')
    const { unmount } = renderPage()
    await screen.findByText('Email verified')
    expect(moduleHolder.mod.getVerifyEmailVisitRecord().snapshotUrl).toContain('code=aaa')
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
    unmount()

    // Second visit: a DIFFERENT token B, live in the URL. The A record must
    // not short-circuit adjudication -- B is judged on its own merits.
    window.history.replaceState(null, '', '/verify-email?code=bbb')
    setCapture({ code: 'bbb' })

    renderPage()
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(mocks.supabase.auth.exchangeCodeForSession.mock.calls[0][0]).toContain('code=bbb')

    const record = moduleHolder.mod.getVerifyEmailVisitRecord()
    expect(record).not.toBeNull()
    expect(record.verdict).toBe('verified')
    expect(new URL(record.snapshotUrl).searchParams.get('code')).toBe('bbb')
  })

  it('a bare no-token open with no prior verdict adjudicates fresh as info', async () => {
    // A prior implicit token visit recorded a verified verdict for the
    // token-bearing URL. A bare `/verify-email` open is a DIFFERENT URL.
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })
    window.history.replaceState(null, '', '/verify-email')
    const { unmount } = renderPage()
    await screen.findByText('Email verified')
    unmount()

    await loadPageModule()
    window.history.replaceState(null, '', '/verify-email')
    setCapture()

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(moduleHolder.mod.getVerifyEmailVisitRecord()).not.toBeNull()
    expect(moduleHolder.mod.getVerifyEmailVisitRecord().verdict).toBe('info')
  })

  // ---- (iteration-4 review fixes) ----

  // V1: a held/initial session (auth-js broadcasts it as INITIAL_SESSION) must
  // not fake success for an unrelated link -- only this link's own access_token
  // settles verified. Regression for the unconsumed token-match listener.
  it('a non-matching listener session while an implicit hash is pending stays loading until the real token arrives', async () => {
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'other-token' }))
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).toBeNull()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))
    expect(await screen.findByText('Email verified')).toBeInTheDocument()
  })

  // E1: a re-mount on the SAME consumed snapshot (fresh SPA re-entry, StrictMode
  // remount) must replay the recorded verdict, never hang on `loading`.
  it('a re-mount on a settled verified snapshot replays verified instead of hanging on loading', async () => {
    window.history.replaceState(null, '', '/verify-email?code=abc')
    setCapture({ code: 'abc' })
    window.history.replaceState(null, '', '/verify-email')

    const { unmount } = renderPage()
    await screen.findByText('Email verified')
    unmount()

    // Same module instance (visit record persists), same captured snapshot,
    // live URL back at the consumed form -- adjudication replays, not restarts.
    window.history.replaceState(null, '', '/verify-email')
    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // V2: pkce-stale -- captured code exists but the live URL lost it AND does not
  // match the consumed form (user navigated away mid-redeem). No exchange, no
  // session probe: the evidence is unrecoverable, so expired.
  it('pkce-stale: captured code with a tokenless, non-consumed live URL settles expired', async () => {
    window.history.replaceState(null, '', '/verify-email?code=abc123')
    setCapture({ code: 'abc123' })
    window.history.replaceState(null, '', '/home')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  // V3: the implicit consumed form drops the WHOLE hash -- asserting the strip
  // after an implicit verified match (the PKCE-side strip is already covered).
  it('strips the whole hash after an implicit verified', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    const { unmount } = renderPage()
    await screen.findByText('Email verified')

    expect(window.location.href).not.toMatch(/#/)
    unmount()
  })

  // E3: a PKCE exchange that fails AFTER a concurrent consumer (supabase-js'
  // own boot) stripped the code and settled the live URL at the consumed form
  // is verified, not expired -- the code was real and already redeemed by us.
  it('a failed exchange whose code was already consumed (boot race) settles verified', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockImplementation(() => {
      window.history.replaceState(null, '', '/verify-email')
      return Promise.reject(new Error('code already used'))
    })
    window.history.replaceState(null, '', '/verify-email?code=abc')
    setCapture({ code: 'abc' })

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('unmounting with a pending bounded timer causes no crash and no late settle', () => {
    vi.useFakeTimers()
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    const { unmount } = renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    unmount()
    act(() => { vi.advanceTimersByTime(moduleHolder.mod.SETTLE_TIMEOUT_MS) })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Verification link expired')).toBeNull()
  })

  // blind#1: token-bearing URLs and secrets never reach the console.
  it('never logs token-bearing URLs or secrets to the console', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
      window.history.replaceState(null, '', '/verify-email?code=secret123')
      setCapture({ code: 'secret123' })

      renderPage()
      await screen.findByRole('alert')

      const serialized = [...debugSpy.mock.calls, ...warnSpy.mock.calls]
        .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
        .join('\n')
      expect(serialized).not.toContain('secret123')
    } finally {
      debugSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  // blind#6/#13: error_description without an error param is still an auth
  // rejection -- expired.
  it('error_description alone settles expired', async () => {
    window.history.replaceState(null, '', '/verify-email?error_description=blocked')
    setCapture({ errorDescription: 'blocked' })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('an empty error_description (present but valueless) settles expired, not info', async () => {
    window.history.replaceState(null, '', '/verify-email?error_description=')
    setCapture({ errorDescription: null, hasErrorDescription: true })

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Missing verification link')).toBeNull()
  })

  // E5: the visit log is bounded (oldest-evicting) so a long-lived SPA session
  // cannot grow an unbounded Map across many consumed links.
  it('the visit log stays bounded: the oldest verdict is evicted beyond the cap', async () => {
    // First visit seeds the oldest record.
    window.history.replaceState(null, '', '/verify-email?code=first')
    setCapture({ code: 'first' })
    window.history.replaceState(null, '', '/verify-email')
    const { unmount: unmountFirst } = renderPage()
    await screen.findByText('Email verified')
    unmountFirst()

    for (let i = 0; i < 64; i++) {
      window.history.replaceState(null, '', `/verify-email?code=visit${i}`)
      setCapture({ code: `visit${i}` })
      window.history.replaceState(null, '', '/verify-email')
      const { unmount } = renderPage()
      await screen.findByText('Email verified')
      unmount()
    }

    expect(moduleHolder.mod.getVerifyEmailVisitRecord('http://localhost:3000/verify-email?code=first')).toBeNull()
    expect(moduleHolder.mod.getVerifyEmailVisitRecord('http://localhost:3000/verify-email?code=visit63')).not.toBeNull()
    expect(moduleHolder.mod.getVerifyEmailVisitRecord('http://localhost:3000/verify-email?code=visit63').verdict).toBe('verified')
  })

  // blind#9: loading announces via the component's polite status region.
  it('a11y: the loading state is a polite live region', () => {
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
    setCapture({ accessToken: 'tok', type: 'signup' })

    renderPage()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Verifying your email')
    expect(status.getAttribute('aria-live')).toBe('polite')
  })
})