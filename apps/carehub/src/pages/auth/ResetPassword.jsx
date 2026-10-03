import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, AlertTriangle, CheckCircle } from 'lucide-react'
import { authClient } from '../../lib/authClient'
import { Card, TealBtn, Logo } from '../../components/ui/index'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray400, border } = theme

export default function ResetPassword() {
  const navigate = useNavigate()
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(null) // null loading, true ready, false expired
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function init() {
      setChecking(true)
      // Supabase recovery: link sets session via code in URL (query or hash). Try exchange if present.
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code') || new URLSearchParams(url.hash.replace(/^#/, '?')).get('code')
      const accessToken = new URLSearchParams(url.hash.replace(/^#/, '?')).get('access_token')
      if (code) {
        try {
          const { error } = await authClient.auth.exchangeCodeForSession(window.location.href)
          if (error) console.warn('[reset] exchangeCode error', error.message)
        } catch (e) {
          console.warn('[reset] exchange threw', e.message)
        }
      } else if (accessToken) {
        // Hash fragment session (older flow) — getSession will pick it up via detectSessionInUrl
      }
      // Also handle hash fragment flow (older Supabase)
      // getSession will pick up session from storage/detection
      try {
        const { data } = await authClient.auth.getSession()
        if (cancelled) return
        setSessionReady(!!data?.session)
      } catch (e) {
        if (!cancelled) setSessionReady(false)
      }
      setChecking(false)
    }
    init()
    // Also listen for auth state change (recovery event)
    const { data: sub } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) setSessionReady(true)
    })
    return () => {
      cancelled = true
      try { sub?.subscription?.unsubscribe() } catch (e) {}
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!pass || pass.length < 6) { setErr('Password must be at least 6 characters.'); return }
    if (pass !== confirm) { setErr('Passwords do not match.'); return }
    setLoading(true); setErr('')
    try {
      const { error } = await authClient.auth.updateUser({ password: pass })
      if (error) {
        setErr(error.message || 'Could not update password. Link may have expired.')
        setLoading(false)
        return
      }
      setSuccess(true)
      setTimeout(() => navigate('/login', { replace: true }), 1500)
    } catch (e2) {
      setErr('Connection error. Please try again.')
    }
    setLoading(false)
  }

  const fieldStyle = {
    width: '100%', padding: '13px 14px', borderRadius: theme.radius.lg, border: `1px solid ${border}`,
    fontSize: 14, outline: 'none', boxSizing: 'border-box', background: bg, color: navy, fontFamily: theme.fontFamily,
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: 20 }}>
        <Card style={{ padding: 32, borderRadius: theme.radius.xl, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: gray600 }}>Verifying your reset link…</div>
        </Card>
      </div>
    )
  }

  if (sessionReady === false) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <Card style={{ padding: 32, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3], textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><AlertTriangle size={48} color={theme.danger} /></div>
            <div style={{ fontFamily: fontDisplay, fontSize: 22, fontWeight: 700, color: navy, marginBottom: 8 }}>Link expired</div>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.7, marginBottom: 20 }}>This reset link is invalid or has expired. Please request a new one.</div>
            <Link to="/forgot-password" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: 15, borderRadius: theme.radius.full, background: tealDeep, color: 'white', fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>Request new link</Link>
            <div style={{ marginTop: 12 }}><Link to="/login" style={{ fontSize: 13, color: gray600, textDecoration: 'none' }}>Back to sign in</Link></div>
          </Card>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: 20 }}>
        <Card style={{ padding: 32, borderRadius: theme.radius.xl, textAlign: 'center', maxWidth: 440, width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><CheckCircle size={48} color={theme.success} /></div>
          <div style={{ fontSize: 18, fontWeight: 700, color: navy }}>Password updated!</div>
          <div style={{ fontSize: 13, color: gray600, marginTop: 8 }}>Redirecting you to sign in…</div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 20, color: gray400, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <ChevronLeft size={15} /> Back to sign in
          </Link>
          <div style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}><Logo size={64} /></div>
          <div style={{ fontFamily: fontDisplay, fontSize: 30, fontWeight: 700, color: navy }}>Set new password</div>
          <div style={{ fontSize: 14, color: gray600, marginTop: 6 }}>Choose a strong password</div>
        </div>

        <Card style={{ padding: 32, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
          {err && <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '12px 14px', borderRadius: 10, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{err}</span></div>}
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label htmlFor="new-pass" style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8, display: 'block' }}>New password <span style={{ color: theme.danger }}>*</span></label>
                <div style={{ position: 'relative' }}>
                  <input id="new-pass" value={pass} onChange={e => setPass(e.target.value)} type={show ? 'text' : 'password'} placeholder="••••••••" required style={{ ...fieldStyle, padding: '13px 52px 13px 14px' }} />
                  <button type="button" onClick={() => setShow(!show)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: gray400 }}>{show ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-pass" style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8, display: 'block' }}>Confirm password <span style={{ color: theme.danger }}>*</span></label>
                <input id="confirm-pass" value={confirm} onChange={e => setConfirm(e.target.value)} type="password" placeholder="••••••••" required style={fieldStyle} />
                {pass && confirm && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12, fontWeight: 700, color: pass === confirm ? theme.success : theme.danger }}>
                    {pass === confirm ? '✓ Passwords match' : '✗ Passwords do not match'}
                  </div>
                )}
              </div>
              <TealBtn type="submit" disabled={loading} style={{ padding: '16px', borderRadius: theme.radius.full, fontSize: 15, fontWeight: 800, boxShadow: theme.elevation[2], ...(loading ? {} : { background: tealDeep }) }}>
                {loading ? 'Updating…' : 'Update password'}
              </TealBtn>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
