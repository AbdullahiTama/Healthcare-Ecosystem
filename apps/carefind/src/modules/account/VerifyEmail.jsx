import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MailCheck, MailX, MailQuestionMark } from 'lucide-react'
// Capture MUST precede the supabase import: supabase consumes the token from
// the address bar at boot, so this module snapshot is the only evidence.
import { capturedVerifyEmailParams } from './verifyEmailParams'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Card, TealBtn, Loading } from '../../components/ui'
import Logo from '../social-feed/Logo.jsx'

export const SETTLE_TIMEOUT_MS = 10000

// Only the "signup" link type is an email verification. Recovery/magiclink/
// invite tokens carry access_tokens too but are not this page's business.
const SIGNUP_HASH_TYPES = new Set(['signup'])

const HASH_KEYS_TO_STRIP = new Set(['access_token', 'type', 'error', 'error_description'])

// First settlement wins across mounts. Verified must never be re-litigated
// into "expired" by a duplicate exchange, a stale event, or a React
// StrictMode remount — matches "settle() is terminal/idempotent".
let settledVerdict = null

export function __resetVerifyEmailForTests() {
  settledVerdict = null
}

// Effect-time consumption check only — the token itself was captured at import.
export function tokenStillInUrl() {
  try {
    return Boolean(new URL(window.location.href).searchParams.get('code'))
  } catch (err) {
    console.warn('[VerifyEmail] could not read URL:', err)
    return false
  }
}

export function stripConsumedTokenFromUrl() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('code')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
    HASH_KEYS_TO_STRIP.forEach((key) => hash.delete(key))
    const hashString = Array.from(hash.keys()).length > 0 ? `#${hash.toString()}` : ''
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${hashString}`)
  } catch (err) {
    console.warn('[VerifyEmail] could not strip consumed token:', err)
  }
}

function VerifyEmail() {
  const navigate = useNavigate()
  const { isMobileOrTablet } = useBreakpoint()
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const { code, accessToken, type, error, errorDescription } = capturedVerifyEmailParams

    let timerId = null
    let subscription = null

    const settle = (verdict) => {
      if (settledVerdict) {
        // Re-litigating a settled page (duplicate exchange, late event,
        // StrictMode remount) replays the original verdict instead.
        if (settledVerdict !== verdict) setStatus(settledVerdict)
        return
      }
      settledVerdict = verdict
      if (timerId) {
        clearTimeout(timerId)
        timerId = null
      }
      if (verdict === 'verified') stripConsumedTokenFromUrl()
      setStatus(verdict)
    }

    const startBound = () => {
      if (timerId) return
      timerId = setTimeout(() => settle('expired'), SETTLE_TIMEOUT_MS)
    }

    const subscribe = () => {
      try {
        const res = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token) settle('verified')
        })
        subscription = (res && res.data && res.data.subscription) || null
      } catch (err) {
        console.warn('[VerifyEmail] auth listener failed:', err)
      }
    }

    const checkSession = (counts) => {
      try {
        supabase.auth.getSession()
          .then(({ data }) => {
            const session = data && data.session
            if (counts(session)) settle('verified')
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
    }

    // (3) Supabase itself rejected the token and told us why.
    if (error) {
      console.warn(`[VerifyEmail] auth token error${errorDescription ? `: ${errorDescription}` : ''}`)
      settle('expired')
      return cleanup
    }

    // PKCE (`?code=`) links. In the same browser supabase already exchanged
    // the code at boot, so it has usually vanished from the URL by now —
    // but a link that bypassed the client (cross-device, direct navigation
    // before the app loaded) still lands here with the code intact.
    if (code) {
      if (tokenStillInUrl()) {
        // The client never touched the code: our exchange is authoritative,
        // verdict comes from its result alone.
        startBound()
        try {
          supabase.auth.exchangeCodeForSession(window.location.href)
            .then(({ data, error: exchangeError }) => {
              if (exchangeError || !data?.session) { settle('expired'); return }
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
      } else {
        // Auto-handled at boot: the session supabase just created IS the
        // code's product — any arriving session event or held session counts.
        startBound()
        subscribe()
        checkSession((session) => Boolean(session))
      }
      return cleanup
    }

    // Implicit (`#access_token=...&type=signup`) links. Verified only when
    // the arriving/matching session's access_token is this link's own token.
    if (accessToken && SIGNUP_HASH_TYPES.has(type)) {
      startBound()
      try {
        const res = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token && session.access_token === accessToken) settle('verified')
        })
        subscription = (res && res.data && res.data.subscription) || null
      } catch (err) {
        console.warn('[VerifyEmail] auth listener failed:', err)
      }
      checkSession((session) => session?.access_token === accessToken)
      return cleanup
    }

    // No captured token, or a non-verification link type: nothing to judge.
    // A held session must never fake success here — the page is a dead end
    // until the user opens their actual verification link.
    settle('info')

    return cleanup

    function cleanup() {
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
      <MailQuestionMark size={40} color={theme.textLight} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Missing verification link</h2>
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