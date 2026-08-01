import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { MailCheck } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Card, Inp, TealBtn } from '../../components/ui'
import Logo from '../social-feed/Logo.jsx'

// Two-phase page:
//   1. "Request reset" — send the password-reset email (any user).
//   2. "Set new password" — appears automatically when Supabase fires
//      PASSWORD_RECOVERY on load (the user followed the emailed link, which
//      carries the recovery tokens), or when a session is already present.
function ResetPassword() {
  const { resetPassword, updatePassword } = useAuth()
  const navigate = useNavigate()
  const { isMobileOrTablet } = useBreakpoint()

  const [recovering, setRecovering] = useState(false)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Supabase auto-detects the recovery tokens in the URL hash on load and
  // fires PASSWORD_RECOVERY with a session attached. That event is the
  // signal to show the new-password form.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => { listener.subscription.unsubscribe() }
  }, [])

  async function handleRequest(e) {
    e.preventDefault()
    setError(''); setSending(true)
    const { error: err } = await resetPassword(email.trim())
    setSending(false)
    if (err) { setError(err.message); return }
    setSent(true)
  }

  async function handleNewPassword(e) {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return }
    setSaving(true)
    const { error: err } = await updatePassword(newPassword)
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => navigate('/feed'), 1600)
  }

  const cardContent = sent ? (
    <div style={{ textAlign: 'center', padding: '12px 0' }}>
      <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Check your email</h2>
      <p style={{ margin: 0, fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
        If an account exists for <strong style={{ color: theme.navy }}>{email}</strong>, we sent a reset link.
        Follow it to choose a new password.
      </p>
    </div>
  ) : recovering || saved ? (
    <form onSubmit={handleNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Inp
        label="New password"
        type="password"
        value={newPassword}
        onChange={setNewPassword}
        placeholder="At least 6 characters"
        required
        minLength={6}
      />
      <Inp
        label="Confirm new password"
        type="password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        placeholder="Repeat the new password"
        required
      />
      {error && <p role="alert" aria-live="assertive" style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}
      {saved && <p role="status" style={{ color: theme.success, fontSize: 13, fontWeight: 700, margin: 0 }}>Password updated. Taking you to the feed…</p>}
      <TealBtn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save new password'}</TealBtn>
    </form>
  ) : (
    <form onSubmit={handleRequest} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Inp
        label="Email address"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        required
      />
      {error && <p role="alert" aria-live="assertive" style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}
      <TealBtn type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send reset link'}</TealBtn>
    </form>
  )

  const body = (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: theme.navy, padding: '24px 20px', color: '#fff', borderRadius: '0 0 24px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={26} tone="light" />
      </div>
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box', flex: 1 }}>
        <h1 style={{ fontSize: 21, fontWeight: 900, color: theme.navy, margin: '0 0 4px 0' }}>
          {recovering || saved ? 'Set a new password' : 'Reset your password'}
        </h1>
        <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 20px 0' }}>
          {recovering || saved ? 'Choose a strong password you have not used before.' : 'We will email you a link to reset it.'}
        </p>
        <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
          {cardContent}
        </Card>
        <p style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700, fontSize: 13, textDecoration: 'none', padding: '10px 4px' }}>← Back to login</Link>
        </p>
      </div>
    </div>
  )

  // Same responsive treatment as Login: single column on small screens; the
  // card stays centered on its own subtle page on larger ones.
  if (isMobileOrTablet) return body

  return (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ marginBottom: 24 }}><Logo size={30} /></div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em', color: theme.navy }}>
          {recovering || saved ? 'Set a new password' : 'Reset your password'}
        </h1>
        <p style={{ fontSize: 13.5, color: theme.textLight, margin: '0 0 24px 0' }}>
          {recovering || saved ? 'Choose a strong password you have not used before.' : 'We will email you a link to reset it.'}
        </p>
        <Card style={{ borderRadius: theme.radius.xl, padding: theme.space[9], boxShadow: theme.elevation[2], border: 'none' }}>
          {cardContent}
        </Card>
        <p style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700, fontSize: 13, textDecoration: 'none', padding: '10px 4px' }}>← Back to login</Link>
        </p>
      </div>
    </div>
  )
}

export default ResetPassword
