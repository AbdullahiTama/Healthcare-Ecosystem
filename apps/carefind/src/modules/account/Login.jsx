import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { Card, Inp, TealBtn } from '../../components/ui'

function Login() {
  const [authMethod, setAuthMethod] = useState('email')
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const action = isSignUp ? signUp : signIn
    const { error: authError } = await action(email, password)

    if (authError) {
      setError(authError.message)
    } else if (isSignUp) {
      // New users go to onboarding to complete their profile
      navigate('/onboarding')
    } else {
      navigate('/')
    }

    setLoading(false)
  }

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

              {error && <p role="alert" aria-live="assertive" style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}

              <TealBtn type="submit" disabled={loading}>
                {loading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Log In'}
              </TealBtn>
            </form>
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
        </Card>
      </div>
    </div>
  )
}

export default Login
