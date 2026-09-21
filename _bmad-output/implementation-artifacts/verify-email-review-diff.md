# Review diff -- spec-auth-email-links-work (review_loop_iteration 2)

Scope note: out-of-scope dirty files (email overhaul, parallel payments workflow, shared-email, api handler churn) are excluded. Only the 5 verify-email files follow: 2 tracked modifications + 3 new files.

## apps/carefind/src/main.jsx (diff vs HEAD)

```diff
diff --git a/apps/carefind/src/main.jsx b/apps/carefind/src/main.jsx
index 499cc65..a706b29 100644
--- a/apps/carefind/src/main.jsx
+++ b/apps/carefind/src/main.jsx
@@ -21,6 +21,7 @@ const Search = lazy(() => import('./modules/healthcare-discovery/Search.jsx'))
 const BusinessProfile = lazy(() => import('./modules/business-profiles-reviews/BusinessProfile.jsx'))
 const Login = lazy(() => import('./modules/account/Login.jsx'))
 const ResetPassword = lazy(() => import('./modules/account/ResetPassword.jsx'))
+const VerifyEmail = lazy(() => import('./modules/account/VerifyEmail.jsx'))
 const Onboarding = lazy(() => import('./modules/account/Onboarding.jsx'))
 const Profile = lazy(() => import('./modules/account/Profile.jsx'))
 const PublicProfile = lazy(() => import('./PublicProfile.jsx'))
@@ -89,6 +90,7 @@ const RoutesWithKey = () => {
       <Route path="/business/:id" element={<SuspenseWrapper><BusinessProfile /></SuspenseWrapper>} />
       <Route path="/login" element={<SuspenseWrapper><Login /></SuspenseWrapper>} />
       <Route path="/reset-password" element={<SuspenseWrapper><ResetPassword /></SuspenseWrapper>} />
+      <Route path="/verify-email" element={<SuspenseWrapper><VerifyEmail /></SuspenseWrapper>} />
       <Route path="/u/:id" element={<SuspenseWrapper><PublicProfile /></SuspenseWrapper>} />
       <Route path="/post/:id" element={<SuspenseWrapper><PostPage /></SuspenseWrapper>} />
       <Route path="/drug/:name" element={<SuspenseWrapper><DrugProfile /></SuspenseWrapper>} />
```

## apps/carefind/src/providers/AuthContext.jsx (diff vs HEAD)

```diff
diff --git a/apps/carefind/src/providers/AuthContext.jsx b/apps/carefind/src/providers/AuthContext.jsx
index b61d18c..cd0b432 100644
--- a/apps/carefind/src/providers/AuthContext.jsx
+++ b/apps/carefind/src/providers/AuthContext.jsx
@@ -36,10 +36,14 @@ export function AuthProvider({ children }) {
           actions.push('email_verification')
         }
         for (const action of actions) {
+          const payload = { action, email, fullName }
+          if (action === 'email_verification') {
+            payload.redirectTo = `${window.location.origin}/verify-email`
+          }
           fetch('/api/auth-email', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
-            body: JSON.stringify({ action, email, fullName }),
+            body: JSON.stringify(payload),
           }).catch(() => {})
         }
       }
```

## apps/carefind/src/modules/account/VerifyEmail.jsx (NEW, untracked)

```jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MailCheck, MailX, MailQuestion } from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Card, TealBtn, Loading } from '../../components/ui'
import Logo from '../social-feed/Logo.jsx'

export const SETTLE_TIMEOUT_MS = 10000

const SIGNUP_HASH_TYPES = new Set(['signup'])

function VerifyEmail() {
  const navigate = useNavigate()
  const { isMobileOrTablet } = useBreakpoint()
  const [status, setStatus] = useState('loading')
  const settledRef = useRef(false)

  useEffect(() => {
    settledRef.current = false
    let cancelled = false
    let timerId = null
    let subscription = null

    const settle = (verdict) => {
      if (settledRef.current || cancelled) return
      settledRef.current = true
      if (timerId) {
        clearTimeout(timerId)
        timerId = null
      }
      setStatus(verdict)
    }

    const startBound = () => {
      if (timerId) return
      timerId = setTimeout(() => settle('expired'), SETTLE_TIMEOUT_MS)
    }

    let code = null
    let accessToken = null
    let type = null
    try {
      const url = new URL(window.location.href)
      code = url.searchParams.get('code')
      const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
      accessToken = hash.get('access_token')
      type = hash.get('type')
    } catch (err) {
      console.warn('[VerifyEmail] could not read URL:', err)
    }

    if (code) {
      startBound()
      try {
        supabase.auth.exchangeCodeForSession(window.location.href)
          .then(({ data, error }) => {
            if (error || !data?.session) { settle('expired'); return }
            settle('verified')
          })
          .catch((err) => {
            console.warn('[VerifyEmail] code exchange failed:', err)
            settle('expired')
          })
      } catch (err) {
        console.warn('[VerifyEmail] code exchange failed:', err)
        settle('expired')
      }
    } else if (accessToken && SIGNUP_HASH_TYPES.has(type)) {
      startBound()
      try {
        const res = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token && session.access_token === accessToken) settle('verified')
        })
        subscription = (res && res.data && res.data.subscription) || null
      } catch (err) {
        console.warn('[VerifyEmail] auth listener failed:', err)
      }
      try {
        supabase.auth.getSession()
          .then(({ data }) => {
            const session = data && data.session
            if (session?.access_token === accessToken) settle('verified')
            else settle('expired')
          })
          .catch((err) => {
            console.warn('[VerifyEmail] getSession failed:', err)
            settle('expired')
          })
      } catch (err) {
        console.warn('[VerifyEmail] getSession failed:', err)
        settle('expired')
      }
    } else {
      settle('info')
    }

    return () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
      if (subscription && subscription.unsubscribe) subscription.unsubscribe()
    }
  }, [])

  const cardContent = status === 'loading' ? (
    <Loading text="Verifying your email..." />
  ) : status === 'verified' ? (
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Email verified</h2>
      <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
        Your email has been confirmed. You can now continue to your account.
      </p>
      <TealBtn onClick={() => navigate('/onboarding')}>Continue to onboarding</TealBtn>
    </div>
  ) : status === 'expired' ? (
    <div role="alert" aria-live="assertive" style={{ textAlign: 'center', padding: '12px 0' }}>
      <MailX size={40} color={theme.alert} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Verification link expired</h2>
      <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
        This link has expired or was already used. Please log in, or contact support if you believe this is an error.
      </p>
      <TealBtn variant="ghost" onClick={() => navigate('/login')}>Back to login</TealBtn>
    </div>
  ) : (
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <MailQuestion size={40} color={theme.textLight} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Missing verification link</h2>
      <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
        This page verifies your email using the link in your email. Open the verification link you received to continue.
      </p>
      <TealBtn variant="ghost" onClick={() => navigate('/login')}>Back to login</TealBtn>
    </div>
  )

  const body = (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: theme.navy, padding: '24px 20px', color: '#fff', borderRadius: '0 0 24px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={26} tone="light" />
      </div>
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box', flex: 1 }}>
        <h1 style={{ fontSize: 21, fontWeight: 900, color: theme.navy, margin: '0 0 4px 0' }}>
          Verify your email
        </h1>
        <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 20px 0' }}>
          Confirming your CareFind account.
        </p>
        <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
          {cardContent}
        </Card>
        {status !== 'verified' && (
          <p style={{ textAlign: 'center', marginTop: 18 }}>
            <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700, fontSize: 13, textDecoration: 'none', padding: '10px 4px' }}> Back to login</Link>
          </p>
        )}
      </div>
    </div>
  )

  if (isMobileOrTablet) return body

  return (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 24 }}><Logo size={30} /></div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em', color: theme.navy }}>
          Verify your email
        </h1>
        <p style={{ fontSize: 13.5, color: theme.textLight, margin: '0 0 24px 0' }}>
          Confirming your CareFind account.
        </p>
        <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
          {cardContent}
        </Card>
        {status !== 'verified' && (
          <p style={{ textAlign: 'center', marginTop: 18 }}>
            <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700, fontSize: 13, textDecoration: 'none', padding: '10px 4px' }}> Back to login</Link>
          </p>
        )}
      </div>
    </div>
  )
}

export default VerifyEmail
```

## apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx (NEW, untracked)

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import VerifyEmail, { SETTLE_TIMEOUT_MS } from '../VerifyEmail.jsx'

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
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('PKCE success settles verified from the exchange result, not a re-getSession', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
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
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Verification link expired')
  })

  it('exchange rejection settles expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('an already-verified user clicking a fresh valid PKCE link still sees verified (stored session never blocks)', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'stored', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=fresh')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('no-token open renders info even while a session is mocked in storage', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email')

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
  })

  it('non-signup hash type with an access_token shape does not fake success', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=recovery')

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('implicit success via an arriving matching-session event', async () => {
    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
  })

  it('implicit success via the single gated getSession when the token matches', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(mocks.supabase.auth.getSession).toHaveBeenCalledTimes(1)
  })

  it('a non-matching stored session never flips an implicit hash to verified', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'other', user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('a listener-emitted session on a tokenless page stays info', async () => {
    window.history.replaceState(null, '', '/verify-email')

    renderPage()
    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()

    act(() => emit('SIGNED_IN', { access_token: 'tok' }))

    expect(screen.getByText('Missing verification link')).toBeInTheDocument()
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('a listener-emitted session on a failed page stays expired', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
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
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(SETTLE_TIMEOUT_MS) })

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('hung exchangeCodeForSession expires via the bounded timer', () => {
    vi.useFakeTimers()
    mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', '/verify-email?code=pending')

    renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(SETTLE_TIMEOUT_MS) })

    expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('implicit-hash null session after resolution settles expired', async () => {
    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
  })

  it('unmounting mid-exchange causes no crash and no late settle', async () => {
    let resolveExchange
    mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise((r) => { resolveExchange = r }))
    window.history.replaceState(null, '', '/verify-email?code=pending')

    const { unmount } = renderPage()
    expect(screen.getByText(/Verifying/)).toBeInTheDocument()

    unmount()

    await act(async () => { resolveExchange({ data: { session: { user: { id: 'u1' } } }, error: null }) })
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('expired copy does not promise a resend path', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
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
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    renderPage()
    await screen.findByText('Email verified')

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Continue to onboarding')
  })

  it('verified CTA navigates to /onboarding', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    window.history.replaceState(null, '', '/verify-email?code=abc123')

    renderPage()
    fireEvent.click(await screen.findByText('Continue to onboarding'))

    expect(screen.getByText('ONBOARDING')).toBeInTheDocument()
  })

  it('expired CTA navigates to /login', async () => {
    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
    window.history.replaceState(null, '', '/verify-email?code=bad')

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to login' }))

    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('info CTA navigates to /login', async () => {
    window.history.replaceState(null, '', '/verify-email')

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to login' }))

    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('unmount unsubscribes the auth listener', () => {
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')

    const { unmount } = renderPage()
    expect(mocks.listeners.size).toBeGreaterThan(0)

    unmount()

    expect(mocks.unsub).toHaveBeenCalled()
  })

  it('settles to info synchronously for a bare non-signup type', async () => {
    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=magiclink')

    renderPage()

    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
  })
})
```

## apps/carefind/src/providers/__tests__/AuthContext.test.jsx (NEW, untracked)

```jsx
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
```