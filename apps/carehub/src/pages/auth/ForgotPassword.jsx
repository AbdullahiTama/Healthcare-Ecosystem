import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, AlertTriangle, Mail, CheckCircle } from 'lucide-react'
import { authClient } from '../../lib/authClient'
import { Card, TealBtn, Logo } from '../../components/ui/index'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray400, border } = theme

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!normalized) { setErr('Please enter your email address.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setErr('Please enter a valid email address.'); return }
    setLoading(true); setErr('')
    try {
      const { error } = await authClient.auth.resetPasswordForEmail(normalized, {
        redirectTo: window.location.origin + '/reset-password',
      })
      if (error) {
        // Do not leak; still show generic success per spec, but log
        console.warn('[forgot] reset error', error.message)
      }
      setSent(true)
    } catch (e2) {
      setErr('Connection error. Please check your internet and try again.')
    }
    setLoading(false)
  }

  const fieldStyle = {
    width: '100%', padding: '13px 14px', borderRadius: theme.radius.lg, border: `1px solid ${border}`,
    fontSize: 14, outline: 'none', boxSizing: 'border-box', background: bg, color: navy, fontFamily: theme.fontFamily,
  }

  if (sent) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <Card style={{ padding: 32, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3], textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><CheckCircle size={48} color={theme.success} /></div>
            <div style={{ fontFamily: fontDisplay, fontSize: 22, fontWeight: 700, color: navy, marginBottom: 8 }}>Check your email</div>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.7, marginBottom: 20 }}>
              If an account exists for <strong>{email.trim().toLowerCase()}</strong>, a password reset link has been sent. Please check your inbox and spam folder.
            </div>
            <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: 15, borderRadius: theme.radius.full, background: tealDeep, color: 'white', fontWeight: 800, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}>Back to sign in</Link>
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setSent(false)} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Try another email</button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20, color: gray400, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <ChevronLeft size={15} /> Back to sign in
          </Link>
          <div style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}><Logo size={64} /></div>
          <div style={{ fontFamily: fontDisplay, fontSize: 30, fontWeight: 700, color: navy }}>Forgot password</div>
          <div style={{ fontSize: 14, color: gray600, marginTop: 6 }}>We’ll send you a reset link</div>
        </div>

        <Card style={{ padding: 32, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
          {err && <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '12px 14px', borderRadius: 10, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{err}</span></div>}
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label htmlFor="forgot-email" style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8, display: 'block' }}>Email address <span style={{ color: theme.danger }}>*</span></label>
                <div style={{ position: 'relative' }}>
                  <Mail size={15} color={gray400} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input id="forgot-email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" autoComplete="email" required style={{ ...fieldStyle, paddingLeft: 36 }} />
                </div>
              </div>
              <TealBtn type="submit" disabled={loading} style={{ padding: '16px', borderRadius: theme.radius.full, fontSize: 15, fontWeight: 800, boxShadow: theme.elevation[2], ...(loading ? {} : { background: tealDeep }) }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </TealBtn>
            </div>
          </form>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Link to="/login" style={{ fontSize: 13, color: tealDeep, fontWeight: 700, textDecoration: 'none' }}>Remember your password? Sign in</Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
