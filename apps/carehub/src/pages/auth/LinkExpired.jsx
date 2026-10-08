import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Clock, Link2Off } from 'lucide-react'
import { readLinkExpiredParams } from '@care-ecosystem/shared-email/authLinkError'
import { Card, Logo } from '../../components/ui/index'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray500, border } = theme

// Copy comes only from these tables, picked by the allow-listed reason/kind: never from the URL (see authLinkError.js).
const TITLES = {
  expired: 'This link has expired',
  invalid: 'This link can’t be used',
}
const BODIES = {
  password_reset: 'Password reset and invitation links work once and expire after a short time. Request a new link and open the newest email we send you.',
  email_verification: 'Verification links work once and expire after a short time. Sign in to continue.',
  auth: 'Links in our emails work once and expire after a short time. If you were resetting your password or setting up a staff account, request a new link. Otherwise, sign in to continue.',
}

const action = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 44, padding: 13,
  borderRadius: theme.radius.full, fontWeight: 800, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box',
}

// Where an expired emailed link ends up (lib/authLinkErrorRedirect.js), instead of the landing page.
export default function LinkExpired() {
  const { search } = useLocation()
  const { reason, kind } = readLinkExpiredParams(search)
  const headingRef = useRef(null)
  const Icon = reason === 'expired' ? Clock : Link2Off
  const verifying = kind === 'email_verification'

  useEffect(() => {
    document.title = `${TITLES[reason]} · CareHub`
    // the user arrived from an email, not by navigating: put screen readers straight on the explanation
    headingRef.current?.focus()
  }, [reason])

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px 16px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <Link to="/" aria-label="CareHub home"><Logo size={56} /></Link>
        </div>
        <Card style={{ padding: 32, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3], textAlign: 'center' }}>
          <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><Icon size={48} color={theme.amber} /></div>
          <h1 ref={headingRef} tabIndex={-1} style={{ fontFamily: fontDisplay, fontSize: 22, fontWeight: 700, color: navy, margin: '0 0 8px', outline: 'none' }}>
            {TITLES[reason]}
          </h1>
          <p style={{ fontSize: 13, color: gray600, lineHeight: 1.7, margin: '0 0 20px' }}>{BODIES[kind]}</p>

          <nav aria-label="What to do next" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {verifying ? (
              <Link to="/login" style={{ ...action, background: tealDeep, color: 'white' }}>Sign in</Link>
            ) : (
              <>
                <Link to="/forgot-password" style={{ ...action, background: tealDeep, color: 'white' }}>Request a new link</Link>
                <Link to="/login" style={{ ...action, background: 'white', color: navy, border: `1px solid ${border}` }}>Sign in</Link>
              </>
            )}
            <Link to="/" style={{ fontSize: 13, color: gray600, textDecoration: 'none', padding: '10px 4px' }}>Go to the home page</Link>
          </nav>

          {!verifying && (
            <p style={{ fontSize: 12, color: gray500, lineHeight: 1.6, margin: '16px 0 0' }}>
              Invited by a business? Ask them to send your invitation again.
            </p>
          )}
        </Card>
      </div>
    </main>
  )
}
