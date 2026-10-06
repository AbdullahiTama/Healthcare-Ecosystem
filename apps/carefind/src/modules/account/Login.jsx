import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Button, Card, Inp } from '../../components/ui'
import { AlertCircle, ArrowLeft, MailCheck } from 'lucide-react'
import Logo from '../social-feed/Logo.jsx'
import { TRUST_POINTS } from '../marketplace/trustPoints.js'

const PHOTO_ALT = 'A smiling pharmacist in a white coat checking her phone in a pharmacy'

// Shared pill styling for the Email/Phone switch and the primary actions, so
// the login matches the dashboard's rounded-pill design language.
function MethodButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1, minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.full, border: 'none',
        background: active ? theme.tealDeep : 'transparent',
        color: active ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13, cursor: 'pointer',
        fontFamily: theme.fontFamily,
      }}
    >
      {children}
    </button>
  )
}

function TrustPoints() {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
      {TRUST_POINTS.map(({ Icon, title, text }) => (
        <li key={title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 38, height: 38, borderRadius: theme.radius.full, background: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Icon size={19} color={theme.tealDeep} strokeWidth={1.8} />
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: theme.navy }}>{title}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: theme.textMid, lineHeight: 1.4 }}>{text}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Login() {
  const [authMethod, setAuthMethod] = useState('email')
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [location, setLocation] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const { isMobileOrTablet } = useBreakpoint()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (isSignUp) {
      // Location is stored in auth metadata (global — any city or country)
      // so onboarding and the profile can prefill it.
      const { data, error: authError } = await signUp(email, password, { location: location.trim() || null })
      if (authError) {
        setError(authError.message)
      } else if (!data?.session) {
        // Email confirmation is required — Supabase created the user but no
        // session: tell them to check their inbox instead of navigating on.
        setConfirmationSent(true)
      } else {
        navigate('/onboarding')
      }
    } else {
      const { error: authError } = await signIn(email, password)
      if (authError) {
        setError(authError.message)
      } else {
        const { data: admin } = await supabase.rpc('get_my_admin_info')

        if (admin) {
          const token = btoa(`${admin.id}|${admin.role}|${Date.now()}`)
          localStorage.setItem('admin_token', token)
          localStorage.setItem('admin_user', JSON.stringify(admin))
          navigate('/admin')
        } else {
          navigate('/feed')
        }
      }
    }

    setLoading(false)
  }

  const title = isSignUp ? 'Create your account' : 'Welcome back'
  const subtitle = isSignUp ? 'Join the CareFind community' : 'Log in to continue'

  const authForm = (
    <>
      <div
        role="group"
        aria-label="Sign-in method"
        style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 20, borderRadius: theme.radius.full, background: theme.tealMist }}
      >
        <MethodButton active={authMethod === 'email'} onClick={() => setAuthMethod('email')}>Email</MethodButton>
        <MethodButton active={authMethod === 'phone'} onClick={() => setAuthMethod('phone')}>Phone</MethodButton>
      </div>

      {authMethod === 'email' ? (
        confirmationSent ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
            <p style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>Confirm your email</p>
            <p style={{ margin: '0 0 12px 0', fontSize: 13.5, color: theme.textMid, lineHeight: 1.55 }}>
              We sent a confirmation link to <strong style={{ color: theme.navy }}>{email}</strong>. Click it to activate your account, then log in.
            </p>
            <button
              type="button"
              onClick={() => { setConfirmationSent(false); setIsSignUp(false); setError('') }}
              style={{ background: 'none', border: 'none', color: theme.tealDeep, fontWeight: 700, fontSize: 13.5, padding: '10px 4px', minHeight: 44, cursor: 'pointer' }}
            >
              Back to log in
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Inp
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            required
          />
          <Inp
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            required
            minLength={6}
          />
          {isSignUp && (
            <>
              <Inp
                label="Your location (city, state or country)"
                type="text"
                value={location}
                onChange={setLocation}
                placeholder="e.g. Lagos, Nigeria"
              />
              <p style={{ margin: '-6px 0 0 0', fontSize: 12, color: theme.textMid }}>Anywhere in the world. Buyers near you will find your listings faster.</p>
            </>
          )}

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, margin: 0, padding: '10px 12px',
                borderRadius: theme.radius.md, background: theme.dangerBg, color: theme.alert, fontSize: 13,
              }}
            >
              <AlertCircle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            loadingText="Please wait..."
            style={{ borderRadius: theme.radius.full, marginTop: 4 }}
          >
            {isSignUp ? 'Sign Up' : 'Log In'}
          </Button>
          {!isSignUp && (
            <p style={{ margin: 0, textAlign: 'center' }}>
              <Link to="/reset-password" style={{ display: 'inline-block', padding: '10px 4px', color: theme.tealDeep, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Forgot password?</Link>
            </p>
          )}
        </form>
        )
      ) : (
        <p style={{ color: theme.textMid, fontSize: 13.5 }}>
          Phone login is coming soon. Please use email for now.
        </p>
      )}

      <p style={{ marginTop: 16, marginBottom: 0, fontSize: 13, color: theme.textMid, textAlign: 'center' }}>
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError('') }}
          style={{ background: 'none', border: 'none', color: theme.tealDeep, fontWeight: 700, padding: '10px 4px', minHeight: 44, cursor: 'pointer', fontFamily: theme.fontFamily }}
        >
          {isSignUp ? 'Log In' : 'Sign Up'}
        </button>
      </p>
    </>
  )

  const cardStyle = { borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none', background: '#fff' }

  // Mobile/tablet: a compact mint header (logo, headline, small portrait) with
  // the form card overlapping it. The photo stays small so the form is above
  // the fold on a phone. Tablet gets the same design with more breathing room.
  if (isMobileOrTablet) {
    return (
      <div style={{ fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', minHeight: '100vh', background: theme.bg }}>
        <div style={{ background: theme.tealMist, padding: '20px 20px 56px 20px', borderRadius: '0 0 28px 28px' }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, color: theme.tealDeep, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 8 }}>
            <div style={{ minWidth: 0 }}>
              <Logo size={26} tone="dark" style={{ marginBottom: 16 }} />
              <h1 style={{ fontSize: 23, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em', color: theme.navy }}>{title}</h1>
              <p style={{ fontSize: 13.5, color: theme.textMid, margin: 0 }}>{subtitle}</p>
            </div>
            <img
              src="/images/login-pharmacist-sm.jpg"
              alt={PHOTO_ALT}
              width={84}
              height={84}
              decoding="async"
              style={{ width: 84, height: 84, borderRadius: theme.radius.full, objectFit: 'cover', objectPosition: 'center 22%', flexShrink: 0, border: '3px solid #fff' }}
            />
          </div>
        </div>

        <div style={{ padding: '0 20px 32px 20px', marginTop: -32 }}>
          <Card style={cardStyle}>{authForm}</Card>
        </div>
      </div>
    )
  }

  // Laptop+: a genuine two-panel desktop composition (brand story and portrait
  // left, form right) rather than a 420px mobile card adrift in a mostly-empty
  // monitor.
  return (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', display: 'flex' }}>
      <div style={{
        flex: '0 0 48%', maxWidth: 680, background: theme.tealMist,
        padding: '40px 48px', display: 'flex', flexDirection: 'column', gap: 24,
        boxSizing: 'border-box',
      }}>
        <Logo size={32} tone="dark" />

        <div>
          <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.tealDeep }}>Healthcare marketplace</p>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 12px 0', color: theme.navy }}>
            Find trusted health products near you
          </h1>
          <p style={{ fontSize: 15, color: theme.textMid, lineHeight: 1.6, margin: 0, maxWidth: 440 }}>
            Search for healthcare providers, medicines, laboratory services and healthcare facilities near you.
          </p>
        </div>

        <div style={{ position: 'relative', flex: 1, minHeight: 240, borderRadius: 28, overflow: 'hidden', background: theme.tealDeep }}>
          <img
            src="/images/login-pharmacist.jpg"
            alt={PHOTO_ALT}
            width={900}
            height={1080}
            decoding="async"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%' }}
          />
        </div>

        <TrustPoints />
      </div>

      <div style={{ flex: 1, background: theme.bg, display: 'flex', flexDirection: 'column', padding: '32px 40px', boxSizing: 'border-box' }}>
        <Link to="/" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, color: theme.tealDeep, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to CareFind
        </Link>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <h2 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em', color: theme.navy }}>{title}</h2>
            <p style={{ fontSize: 13.5, color: theme.textMid, margin: '0 0 24px 0' }}>{subtitle}</p>
            <Card style={cardStyle}>{authForm}</Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
