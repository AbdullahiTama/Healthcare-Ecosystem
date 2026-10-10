import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, Plus } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import { resolveAccountByEmail } from '../../services/supabase'
import { authClient } from '../../lib/authClient'
import { Card, TealBtn, Logo } from '../../components/ui/index'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray400, border } = theme

export default function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [unverified, setUnverified] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async () => {
    if (!email || !pass) { setErr('Please enter your email and password.'); return }
    setLoading(true); setErr(''); setUnverified(false); setResent(false)
    const normalizedEmail = email.toLowerCase()

    // C2: the plaintext password columns and legacy_login_business are gone, so
    // a real Supabase Auth session is the only way in. Legacy accounts were
    // backfilled to confirmed auth users (2026-08-02, then 2026-08-13 for the
    // 10 stragglers). New owners now arrive UNCONFIRMED: register_business
    // creates them that way and they must verify through the emailed link
    // (which also lets them choose their password) before they can sign in.
    // Supabase reports that state as `email_not_confirmed`, which we surface
    // as a verification prompt rather than a wrong-password error.
    try {
      const { data, error } = await authClient.auth.signInWithPassword({ email: normalizedEmail, password: pass })
      if (error?.code === 'email_not_confirmed') {
        setUnverified(true)
        setLoading(false)
        return
      }
      if (!data?.session || error) {
        setErr('Incorrect email or password. Please try again.')
        setLoading(false)
        return
      }
      const account = await resolveAccountByEmail(normalizedEmail)
      if (!account) {
        setErr('No CareHub business or staff account matches this email.')
        setLoading(false)
        return
      }
      if (account.biz.is_platform_admin) {
        login(account.biz, null, { isAdmin: true, role: 'SuperAdmin' })
        navigate('/admin')
        return
      }
      if (account.biz.status === 'pending') { setErr('Your account is pending admin approval. You will be notified once approved.'); setLoading(false); return }
      if (account.biz.status === 'suspended') { setErr('Your account has been suspended. Contact support@carehub.ng'); setLoading(false); return }
      login(account.biz, account.staff)
      navigate('/dashboard/dashboard')
    } catch (e) {
      console.error('[Login] Error:', e)
      setErr(e.message || 'Connection error. Check your internet and try again.')
    }
    setLoading(false)
  }

  // Resend goes through the public auth-email `password_reset` action, whose
  // response is deliberately generic (and rate limited), so the confirmation
  // is the same whatever the outcome.
  const resendLink = async () => {
    if (resending) return
    setResending(true)
    try {
      await fetch('/api/auth-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'password_reset', email: email.toLowerCase() }),
      })
    } catch { /* the response is generic either way */ }
    setResending(false)
    setResent(true)
  }

  // Input fields use the page's own cream `bg` as their fill (rather than
  // the shared `Inp` component's white), matching the reference design's
  // subtle contrast against the white card — scoped to this branded auth
  // screen rather than changed globally, since every other form in the app
  // still relies on Inp's white fields.
  const fieldStyle = {
    width: '100%', padding: '13px 14px', borderRadius: theme.radius.lg, border: `1px solid ${border}`,
    fontSize: 14, outline: 'none', boxSizing: 'border-box', background: bg, color: navy, fontFamily: theme.fontFamily,
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link to='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20, color: gray400, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <ChevronLeft size={15} /> Back to Home
          </Link>
          <div style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}><Logo size={64} /></div>
          <div style={{ fontFamily: fontDisplay, fontSize: 30, fontWeight: 700, color: navy }}>CareHub</div>
          <div style={{ fontSize: 14, color: gray600, marginTop: 6 }}>Sign in to your workspace</div>
        </div>

        <Card style={{ padding: 32, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
          {unverified && (
            <div role="alert" style={{ marginBottom: 16, padding: 14, borderRadius: theme.radius.lg, background: 'var(--teal-mist)', color: navy, fontSize: 13, lineHeight: 1.6 }}>
              <strong>Verify your email to continue.</strong> We sent a link to {email}. Open it to confirm your address and choose a password.
              {resent
                ? <div style={{ marginTop: 8 }}>A new link is on its way. Check spam if it does not arrive.</div>
                : <button type="button" onClick={resendLink} disabled={resending} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', padding: 0, color: tealDeep, fontWeight: 700, fontSize: 13, cursor: resending ? 'default' : 'pointer', opacity: resending ? 0.6 : 1 }}>{resending ? 'Sending…' : 'Send a new link'}</button>}
            </div>
          )}
          {err && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '12px 14px', borderRadius: 10, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8 }}>Email address <span style={{ color: theme.danger }}>*</span></div>
              <input value={email} onChange={e => setEmail(e.target.value)} type='email' placeholder='you@example.com'
                onKeyDown={e => e.key === 'Enter' && handleLogin()} style={fieldStyle} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8 }}>Password <span style={{ color: theme.danger }}>*</span></div>
              <div style={{ position: 'relative' }}>
                <input value={pass} onChange={e => setPass(e.target.value)} type={show ? 'text' : 'password'} placeholder='••••••••'
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  style={{ ...fieldStyle, padding: '13px 52px 13px 14px' }} />
                <button onClick={() => setShow(!show)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: gray400 }}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <TealBtn onClick={handleLogin} disabled={loading} style={{ padding: '16px', borderRadius: theme.radius.full, fontSize: 15, fontWeight: 800, boxShadow: theme.elevation[2], marginTop: 4, ...(loading ? {} : { background: tealDeep }) }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </TealBtn>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Link to="/forgot-password" style={{ fontSize: 13, color: tealDeep, fontWeight: 700, textDecoration: 'none' }}>Forgot password?</Link>
            </div>
          </div>
        </Card>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <div style={{ fontSize: 13, color: gray600, marginBottom: 12 }}>Don't have an account?</div>
          <Link to='/register' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: 15, borderRadius: theme.radius.full, border: `1.5px solid ${tealDeep}`, color: tealDeep, fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}>
            <Plus size={16} /> Register your business, free
          </Link>
        </div>
      </div>
    </div>
  )
}
