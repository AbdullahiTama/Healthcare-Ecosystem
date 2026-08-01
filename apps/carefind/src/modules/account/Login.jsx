import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Card, Inp, TealBtn } from '../../components/ui'
import { MailCheck } from 'lucide-react'
import Logo from '../social-feed/Logo.jsx'

// Real, existing features only — no invented stats or testimonials (there's
// no real usage data to quote yet), mirrors this file's own "specific over
// fabricated" writing rule.
const VALUE_PROPS = [
  { icon: '🔍', text: 'Search medicines, pharmacies, hospitals and labs near you' },
  { icon: '⭐', text: 'Real reviews from patients who’ve actually been there' },
  { icon: '💬', text: 'Message sellers and providers directly on WhatsApp' },
]

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
        navigate('/feed')
      }
    }

    setLoading(false)
  }

  const authForm = (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button
          onClick={() => setAuthMethod('email')}
          style={{
            flex: 1, minHeight: 44, padding: 9, borderRadius: 12, border: authMethod === 'email' ? 'none' : `1px solid ${theme.border}`,
            background: authMethod === 'email' ? theme.tealGradient : theme.bg,
            color: authMethod === 'email' ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13,
          }}
        >
          Email
        </button>
        <button
          onClick={() => setAuthMethod('phone')}
          style={{
            flex: 1, minHeight: 44, padding: 9, borderRadius: 12, border: authMethod === 'phone' ? 'none' : `1px solid ${theme.border}`,
            background: authMethod === 'phone' ? theme.tealGradient : theme.bg,
            color: authMethod === 'phone' ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13,
          }}
        >
          Phone
        </button>
      </div>

      {authMethod === 'email' ? (
        confirmationSent ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
            <p style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>Confirm your email</p>
            <p style={{ margin: '0 0 12px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
              We sent a confirmation link to <strong style={{ color: theme.navy }}>{email}</strong>. Click it to activate your account, then log in.
            </p>
            <button
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
              <p style={{ margin: '-6px 0 0 0', fontSize: 11, color: theme.textLight }}>Anywhere in the world. Buyers near you will find your listings faster.</p>
            </>
          )}

          {error && <p role="alert" aria-live="assertive" style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}

          <TealBtn type="submit" disabled={loading}>
            {loading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Log In'}
          </TealBtn>
          {!isSignUp && (
            <p style={{ margin: 0, textAlign: 'center' }}>
              <Link to="/reset-password" style={{ color: theme.textMid, fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>Forgot password?</Link>
            </p>
          )}
        </form>
        )
      ) : (
        <p style={{ color: theme.textLight, fontSize: 13.5 }}>
          Phone login is coming soon. Please use email for now.
        </p>
      )}

      <p style={{ marginTop: 16, fontSize: 13, color: theme.textLight, textAlign: 'center' }}>
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button
          onClick={() => { setIsSignUp(!isSignUp); setError('') }}
          style={{ background: 'none', border: 'none', color: theme.tealDeep, fontWeight: 700, padding: '10px 4px', minHeight: 44 }}
        >
          {isSignUp ? 'Log In' : 'Sign Up'}
        </button>
      </p>
    </>
  )

  // Mobile/tablet: the original single-column layout, hero-then-card. Tablet
  // gets the same design, just more surrounding breathing room from the
  // wider viewport — there's nothing to add at 2 columns for a single form.
  if (isMobileOrTablet) {
    return (
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 420, margin: '0 auto', minHeight: '100vh', background: theme.bg }}>
        <div style={{ background: theme.heroGradient, padding: '24px 20px 50px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Back</Link>
          <h1 style={{ fontSize: 23, fontWeight: 900, margin: '18px 0 4px 0', letterSpacing: '-0.02em' }}>
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
            {isSignUp ? 'Join the CareFind community' : 'Log in to continue'}
          </p>
        </div>

        <div style={{ padding: '0 20px', marginTop: -28 }}>
          <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
            {authForm}
          </Card>
        </div>
      </div>
    )
  }

  // Laptop+: a genuine two-panel desktop composition (brand story left, form
  // right) rather than a 420px mobile card adrift in a mostly-empty monitor.
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', display: 'flex' }}>
      <div style={{
        flex: '0 0 44%', maxWidth: 560, background: theme.heroGradient, color: '#fff',
        padding: '48px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        boxSizing: 'border-box',
      }}>
        <Logo size={32} tone="light" />

        <div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 16px 0' }}>
            Your health marketplace,{' '}all in one place.
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.72)', lineHeight: 1.6, margin: '0 0 32px 0', maxWidth: 420 }}>
            Search for healthcare providers, medicines, laboratory services and healthcare facilities near you.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {VALUE_PROPS.map((v) => (
              <div key={v.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }} aria-hidden="true">{v.icon}</span>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>{v.text}</span>
              </div>
            ))}
          </div>
        </div>

        <Link to="/" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Back to CareFind</Link>
      </div>

      <div style={{ flex: 1, background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em', color: theme.navy }}>
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p style={{ fontSize: 13.5, color: theme.textLight, margin: '0 0 24px 0' }}>
            {isSignUp ? 'Join the CareFind community' : 'Log in to continue'}
          </p>
          <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
            {authForm}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Login
