import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MailCheck, MailX, MailQuestionMark } from 'lucide-react'
// Capture MUST precede the supabase import: supabase consumes the token from
// the address bar at boot, so this module snapshot is the only evidence.
import { capturedVerifyEmailParams, consumedUrlFromHref, currentUrlHref } from './verifyEmailParams'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Card, TealBtn, Loading } from '../../components/ui'
import Logo from '../social-feed/Logo.jsx'

export const SETTLE_TIMEOUT_MS = 10000

// Only the "signup" link type is an email verification. Recovery/magiclink/
// invite tokens carry access_tokens too but are not this page's business.
const SIGNUP_HASH_TYPES = new Set(['signup'])

// Visit-scoped judge, wired to the snapshot at capture time: adjudication
// happens at most once per visited snapshot URL, while a re-run that lands on
// the same consumed URL (StrictMode remount, duplicate exchange, late event)
// replays the recorded verdict. A genuinely different token URL adjudicates
// fresh. `verdict` is terminal per snapshot. Tests isolate this module-level
// state by re-importing the module (vi.resetModules).
//
// `getVerifyEmailVisitRecord` is test-only judge inspection, DEV-gated so the
// production bundle ships `undefined` (Vite inlines `import.meta.env.DEV` to
// false and Rollup tree-shakes the branch). The judged record holds the
// token-bearing snapshot URL, so it must never be reachable from production
// code -- KEEP: "no prod test hook".
let judgedSnapshots = new Map()

// Keeps the visit log bounded (oldest-evicting) so a long-lived SPA session
// never grows an unbounded Map across many consumed links.
const MAX_JUDGED_SNAPSHOTS = 64

function rememberJudgedSnapshot(href, record) {
  judgedSnapshots.set(href, record)
  if (judgedSnapshots.size > MAX_JUDGED_SNAPSHOTS) {
    const oldest = judgedSnapshots.keys().next().value
    if (oldest !== undefined) judgedSnapshots.delete(oldest)
  }
}

export const getVerifyEmailVisitRecord = import.meta.env.DEV
  ? (snapshotHref) => {
      const href = snapshotHref || capturedVerifyEmailParams.href
      if (!href) return null
      return judgedSnapshots.get(href) || null
    }
  : undefined

// Effect-time consumption check only -- the token itself was captured at import.
export function tokenStillInUrl() {
  try {
    return Boolean(new URL(window.location.href).searchParams.get('code'))
  } catch (err) {
    console.warn('[VerifyEmail] could not read URL:', err)
    return false
  }
}

// Rewrites the live URL to the consumption shape of the captured snapshot
// (whole-hash drop for implicit, `code`-strip for PKCE) so a refresh lands on
// `info`, never a re-exchange of a single-use code, and a StrictMode dev
// remount cannot double-exchange into a false `expired`.
export function stripConsumedTokenFromUrl(snapshotHref) {
  const consumedUrl = consumedUrlFromHref(snapshotHref)
  if (!consumedUrl) return
  try {
    const { pathname, search, hash } = new URL(consumedUrl)
    window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`)
  } catch (err) {
    console.warn('[VerifyEmail] could not strip consumed token:', err)
  }
}

function VerifyEmail() {
  const navigate = useNavigate()
  const { isMobileOrTablet } = useBreakpoint()
  const [status, setStatus] = useState('loading')
  const verdictHeadingRef = useRef(null)
  const announcedRef = useRef(false)

  // A11y (iteration-4): announce a verdict exactly once by moving focus to the
  // result heading, which carries a visible focus indicator. Never stack a
  // focus move AND a live region on the same verdict; move focus only on the
  // initial `loading` -> verdict transition, never on later re-runs, and never
  // for `expired` (whose `role="alert"` is the single announcement).
  useLayoutEffect(() => {
    if (status === 'loading') return
    if (announcedRef.current) return
    announcedRef.current = true
    if (status === 'expired') return
    if (verdictHeadingRef.current) verdictHeadingRef.current.focus()
  }, [status])

  useEffect(() => {
    const snapshot = capturedVerifyEmailParams
    const { code, accessToken, type, error, errorDescription, hasErrorDescription } = snapshot
    const snapshotUrl = snapshot.href

    let timerId = null
    let subscription = null

    const consumedUrl = consumedUrlFromHref(snapshotUrl)
    const currentUrl = currentUrlHref()
    const consumedMatch = consumedUrl !== null && currentUrl === consumedUrl

    const settle = (verdict, branch) => {
      const existing = judgedSnapshots.get(snapshotUrl)
      if (existing) {
        // Re-litigating a settled page replays the original verdict instead,
        // even when the fresh argument matches it -- a re-run that mounts at
        // `loading` (fresh SPA re-entry, StrictMode remount) must not hang.
        console.debug('[VerifyEmail] replaying settled verdict', { branch, verdict, recorded: existing.verdict })
        if (timerId) {
          clearTimeout(timerId)
          timerId = null
        }
        if (existing.verdict === 'verified') stripConsumedTokenFromUrl(snapshotUrl)
        setStatus(existing.verdict)
        return
      }
      rememberJudgedSnapshot(snapshotUrl, { verdict, snapshotUrl, consumedUrl })
      console.debug('[VerifyEmail] settling', { branch, verdict, consumedMatch })
      if (timerId) {
        clearTimeout(timerId)
        timerId = null
      }
      if (verdict === 'verified') stripConsumedTokenFromUrl(snapshotUrl)
      setStatus(verdict)
    }

    const startBound = () => {
      if (timerId) return
      timerId = setTimeout(() => settle('expired', 'bounded-timeout'), SETTLE_TIMEOUT_MS)
    }

    // A PKCE exchange that failed at the library boundary may already have been
    // won by supabase-js' own boot exchange (code stripped, live URL at
    // consumption shape) -- then this link was verified, not expired.
    // Otherwise the code is still present (our exchange is authoritative) or
    // the evidence is gone entirely, and the verdict is expired.
    const settleExchangeFailure = () => {
      if (!tokenStillInUrl() && consumedUrl !== null && currentUrlHref() === consumedUrl) {
        settle('verified', 'pkce-boot-consumed')
      } else {
        settle('expired', 'pkce-exchange')
      }
    }

    const subscribe = (branch, counts = () => true) => {
      try {
        const res = supabase.auth.onAuthStateChange((_event, session) => {
          if (counts(session)) settle('verified', branch)
        })
        subscription = (res && res.data && res.data.subscription) || null
        console.debug('[VerifyEmail] gated auth listener armed', { branch })
      } catch (err) {
        console.warn('[VerifyEmail] auth listener failed:', err)
      }
    }

    const checkSession = (counts, branch) => {
      try {
        const res = supabase.auth.getSession()
        Promise.resolve(res)
          .then(({ data } = {}) => {
            const session = data && data.session
            if (counts(session)) settle('verified', branch)
            else settle('expired', branch)
          })
          .catch((err) => {
            console.warn('[VerifyEmail] getSession failed:', err)
            settle('expired', branch)
          })
      } catch (err) {
        console.warn('[VerifyEmail] getSession failed:', err)
        settle('expired', branch)
      }
    }

    // (1) Supabase rejected the token, or the captured evidence is present but
    // empty (`?code=`, `#access_token=`, `?error=`): expired.
    if (snapshot.hasError || snapshot.hasErrorDescription || (snapshot.hasCode && !code) || (snapshot.hasAccessToken && !accessToken)) {
      if (error) console.warn(`[VerifyEmail] auth token error${errorDescription ? `: ${errorDescription}` : ''}`)
      settle('expired', 'error-or-empty-param')
      return cleanup
    }

    // (2) Consumption-shaped replay (the iteration-4 fix): the live URL equals
    // the consumption form of the captured snapshot. supabase-js already
    // validated THIS link (implicit: cleared the whole hash; PKCE: stripped
    // `code`), so the recorded verdict -- which branch 1 could not reach with a
    // non-empty token -- replays as verified. Only these two shapes count.
    if (consumedMatch && ((snapshot.hasCode && code) || (snapshot.hasAccessToken && accessToken && SIGNUP_HASH_TYPES.has(type)))) {
      settle('verified', 'consumed-form-replay')
      return cleanup
    }

    // (3) PKCE (`?code=`) link the client did NOT auto-handle (cross-device,
    // no stored verifier): the code is still in the URL, our exchange is
    // authoritative and its result alone settles the verdict. A vanished code
    // that does not match the consumed form cannot be proven and expires.
    if (snapshot.hasCode) {
      if (tokenStillInUrl()) {
        startBound()
        try {
          const res = supabase.auth.exchangeCodeForSession(window.location.href)
          Promise.resolve(res)
            .then(({ data, error: exchangeError } = {}) => {
              if (exchangeError || !data || !data.session) { settleExchangeFailure(); return }
              settle('verified', 'pkce-exchange')
            })
            .catch((err) => {
              console.warn('[VerifyEmail] code exchange failed:', err)
              settleExchangeFailure()
            })
        } catch (err) {
          console.warn('[VerifyEmail] code exchange failed:', err)
          settleExchangeFailure()
        }
      } else {
        settle('expired', 'pkce-stale')
      }
      return cleanup
    }

    // (4) Implicit (`#access_token=...&type=signup`) link still pending: the
    // hash is present and the code has not consumed it yet. Verified only when
    // the arriving/matching session's access_token is this link's own token.
    if (snapshot.hasAccessToken && accessToken && SIGNUP_HASH_TYPES.has(type)) {
      startBound()
      subscribe('implicit-pending', (session) => session && session.access_token === accessToken)
      checkSession((session) => session && session.access_token === accessToken, 'implicit-pending')
      return cleanup
    }

    // (5) No captured token, or a non-verification link type: nothing to judge.
    // A held session must never fake success here -- the page is a dead end
    // until the user opens their actual verification link.
    settle('info', 'no-token-info')

    return cleanup

    function cleanup() {
      if (timerId) clearTimeout(timerId)
      if (subscription && subscription.unsubscribe) subscription.unsubscribe()
    }
  }, [])

  const cardContent = status === 'loading' ? (
    // Loading already renders an accessible status region (role="status",
    // aria-live="polite"), so no extra live-region wrapper is needed.
    <Loading text="Verifying your email..." />
  ) : status === 'verified' ? (
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2
        ref={verdictHeadingRef}
        tabIndex={-1}
        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outlineStyle: 'solid', outlineWidth: 2, outlineColor: theme.teal, outlineOffset: 2 }}
      >Email verified</h2>
      <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
        Your email has been confirmed. You can now continue to your account.
      </p>
      <TealBtn onClick={() => navigate('/onboarding')}>Continue to onboarding</TealBtn>
    </div>
  ) : status === 'expired' ? (
    // `expired` is the only verdict that carries a live region. `role="alert"`
    // announces it (no redundant explicit `aria-live="assertive"`), and the
    // interactive exit CTA stays OUTSIDE the region -- live regions must not
    // wrap interactive controls. Focus intentionally does not move here.
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <div role="alert" style={{ textAlign: 'center' }}>
        <MailX size={40} color={theme.alert} strokeWidth={1.6} style={{ marginBottom: 10 }} />
        <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Verification link expired</h2>
        <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
          This link has expired or was already used. Please log in, or contact support if you believe this is an error.
        </p>
      </div>
      <TealBtn variant="ghost" onClick={() => navigate('/login')}>Back to login</TealBtn>
    </div>
  ) : (
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <MailQuestionMark size={40} color={theme.textLight} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2
        ref={verdictHeadingRef}
        tabIndex={-1}
        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outlineStyle: 'solid', outlineWidth: 2, outlineColor: theme.teal, outlineOffset: 2 }}
      >Missing verification link</h2>
      <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
        This page verifies your email using the link in your email. Open the verification link you received to continue.
      </p>
      <TealBtn variant="ghost" onClick={() => navigate('/login')}>Back to login</TealBtn>
    </div>
  )

  const heading = (
    <>
      <h1 style={{ fontSize: isMobileOrTablet ? 21 : 26, fontWeight: 900, color: theme.navy, margin: '0 0 4px 0', letterSpacing: '-0.02em' }}>
        Verify your email
      </h1>
      <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 20px 0' }}>
        Confirming your CareFind account.
      </p>
    </>
  )

  const footerLink = status !== 'verified' && (
    <p style={{ textAlign: 'center', marginTop: 18 }}>
      <Link to="/login" style={{ color: 'var(--teal-deep)', fontWeight: 700, fontSize: 13, textDecoration: 'none', padding: '10px 4px' }}>Back to login</Link>
    </p>
  )

  const card = (
    <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
      {cardContent}
    </Card>
  )

  if (isMobileOrTablet) {
    return (
      <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: theme.navy, padding: '24px 20px', color: '#fff', borderRadius: '0 0 24px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={26} tone="light" />
        </div>
        <div style={{ width: '100%', maxWidth: 420, margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box', flex: 1 }}>
          {heading}
          {card}
          {footerLink}
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 24 }}><Logo size={30} /></div>
        {heading}
        {card}
        {footerLink}
      </div>
    </div>
  )
}

export default VerifyEmail