import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Clock, LinkIcon, Home, LogIn, Mail } from 'lucide-react'
import { readLinkExpiredParams } from '@care-ecosystem/shared-email/authLinkError'
import { theme } from '../../styles/theme'
import Logo from '../social-feed/Logo.jsx'

// Business accounts reset their password on CareHub. Its links can land here, because Supabase falls back to the project's
// Site URL (CareFind) when a link's own redirect is not allowed.
const CAREHUB_URL = import.meta.env.VITE_CAREHUB_URL || 'https://carefindhub.com'

// Copy comes only from these tables, picked by the allow-listed reason/kind: never from the URL (see authLinkError.js).
const TITLES = {
  expired: 'This link has expired',
  invalid: 'This link can’t be used',
}
const BODIES = {
  password_reset: 'Password reset links work once and expire after a short time. Request a new link and open the newest email we send you.',
  email_verification: 'Verification links work once and expire after a short time. Sign in and we’ll send you a new one.',
  auth: 'Links in our emails work once and expire after a short time. If you were resetting your password, request a new link. Otherwise, sign in to continue.',
}

const pill = {
  minHeight: 44, padding: '10px 20px', borderRadius: theme.radius.full, textDecoration: 'none',
  fontSize: 14, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const primary = { ...pill, background: theme.tealDeep, color: '#fff', border: 'none' }
const secondary = { ...pill, background: '#fff', color: theme.navy, border: `1px solid ${theme.border}`, fontWeight: 700 }

export default function LinkExpired() {
  const { search } = useLocation()
  const { reason, kind } = readLinkExpiredParams(search)
  const headingRef = useRef(null)
  const Icon = reason === 'expired' ? Clock : LinkIcon

  useEffect(() => {
    document.title = `${TITLES[reason]} · CareFind`
    // the user arrived from an email, not by navigating: put screen readers straight on the explanation
    headingRef.current?.focus()
  }, [reason])

  const verifying = kind === 'email_verification'

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px', boxSizing: 'border-box', background: theme.bg, fontFamily: theme.fontFamily, textAlign: 'center',
    }}>
      <Link to="/" aria-label="CareFind home" style={{ marginBottom: 32, textDecoration: 'none' }}>
        <Logo size={32} tone="dark" />
      </Link>
      <div aria-hidden="true" style={{
        width: 72, height: 72, borderRadius: '50%', background: theme.cardBg, border: `1px solid ${theme.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, color: theme.amber,
      }}>
        <Icon size={28} />
      </div>
      <h1 ref={headingRef} tabIndex={-1} style={{
        margin: '0 0 8px', fontSize: 28, fontWeight: 900, color: theme.navy, fontFamily: theme.fontDisplay,
        letterSpacing: '-0.02em', outline: 'none',
      }}>
        {TITLES[reason]}
      </h1>
      <p style={{ margin: '0 0 28px', fontSize: 15, color: theme.textMid, maxWidth: 440, lineHeight: 1.6 }}>
        {BODIES[kind]}
      </p>

      <nav aria-label="What to do next" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: 440 }}>
        {verifying ? (
          <Link to="/login" className="cf-press" style={primary}><LogIn size={16} aria-hidden="true" /> Sign in</Link>
        ) : (
          <>
            <Link to="/reset-password" className="cf-press" style={primary}><Mail size={16} aria-hidden="true" /> Request a new link</Link>
            <Link to="/login" className="cf-press" style={secondary}><LogIn size={16} aria-hidden="true" /> Sign in</Link>
          </>
        )}
        <Link to="/" className="cf-press" style={secondary}><Home size={16} aria-hidden="true" /> Go home</Link>
      </nav>

      {!verifying && (
        <p style={{ margin: '28px 0 0', fontSize: 13, color: theme.textLight, maxWidth: 440, lineHeight: 1.6 }}>
          Business account on CareHub?{' '}
          <a href={`${CAREHUB_URL}/forgot-password`} style={{ color: theme.tealDeep, fontWeight: 700 }}>Request a new link on CareHub</a>.
        </p>
      )}
    </main>
  )
}
