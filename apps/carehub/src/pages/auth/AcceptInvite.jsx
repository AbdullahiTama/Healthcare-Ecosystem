import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, MailX, UserCheck } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import { resolveAccountByEmail } from '../../services/supabase'
import { authClient } from '../../lib/authClient'
import { invitationService, readableError, MIN_PASSWORD_LENGTH } from '../../modules/staff/services/invitations'
import { Card, TealBtn, GhostBtn, Logo, Loading } from '../../components/ui/index'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray500, border } = theme

// /accept-invite?token=… — where a staff invitation email lands.
//
// Two paths, decided by the server (get_staff_invitation.account_exists):
//   * New to CareHub/CareFind → choose a password here. The account is created
//     by accept_staff_invitation; holding the emailed link proves the inbox.
//   * Already has a login with this email → sign in with THAT password, then
//     accept. The invitation never changes an existing password — the rule
//     whose absence let a staff member's reset overwrite the owner's.
//
// Whatever session this browser holds for someone else (often the owner who
// sent the invite, testing on their own device) is signed out first, so the
// new member never inherits it.
export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { login, logout } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState('loading') // loading | invalid | expired | ready | error
  const [invite, setInvite] = useState(null)
  const [sessionEmail, setSessionEmail] = useState(null)
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [token])

  async function load() {
    setPhase('loading'); setErr('')
    if (!token) { setPhase('invalid'); return }
    try {
      const [info, session] = await Promise.all([
        invitationService.lookup(token),
        authClient.auth.getSession(),
      ])
      setSessionEmail(session?.data?.session?.user?.email?.toLowerCase() || null)
      setInvite(info || null)
      setPhase(info?.state === 'valid' ? 'ready' : info?.state === 'expired' ? 'expired' : 'invalid')
    } catch (e) {
      console.error('[AcceptInvite] lookup failed', e)
      setPhase('error')
    }
  }

  const signedInAsInvitee = !!invite && sessionEmail === invite.email
  const signedInAsSomeoneElse = !!invite && !!sessionEmail && sessionEmail !== invite.email

  async function dropOtherSession() {
    if (!signedInAsSomeoneElse) return
    logout()
    await authClient.auth.signOut().catch(() => {})
    setSessionEmail(null)
  }

  async function enterWorkspace(email) {
    const account = await resolveAccountByEmail(email)
    if (!account?.staff) throw new Error('Your invitation was accepted, but we could not open your workspace. Please sign in.')
    if (account.biz.status !== 'active') throw new Error('You have joined the team, but this business is not active yet. You will be able to sign in once it is approved.')
    login(account.biz, account.staff)
    navigate('/dashboard/dashboard')
  }

  async function createAccount() {
    if (pass.length < MIN_PASSWORD_LENGTH) { setErr(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`); return }
    if (pass !== confirm) { setErr('The two passwords do not match.'); return }
    setBusy(true); setErr('')
    try {
      await dropOtherSession()
      await invitationService.accept(token, pass)
      const { data, error } = await authClient.auth.signInWithPassword({ email: invite.email, password: pass })
      if (error || !data?.session) { navigate('/login'); return }
      await enterWorkspace(invite.email)
    } catch (e) {
      setErr(readableError(e))
      setBusy(false)
    }
  }

  async function acceptWithExistingAccount() {
    setBusy(true); setErr('')
    try {
      if (!signedInAsInvitee) {
        if (!pass) { setErr('Enter your password.'); setBusy(false); return }
        await dropOtherSession()
        const { data, error } = await authClient.auth.signInWithPassword({ email: invite.email, password: pass })
        if (error || !data?.session) { setErr('Incorrect password. Please try again.'); setBusy(false); return }
      }
      await invitationService.accept(token)
      await enterWorkspace(invite.email)
    } catch (e) {
      setErr(readableError(e))
      setBusy(false)
    }
  }

  const fieldStyle = {
    width: '100%', padding: '13px 14px', borderRadius: theme.radius.lg, border: `1px solid ${border}`,
    fontSize: 14, outline: 'none', boxSizing: 'border-box', background: bg, color: navy, fontFamily: theme.fontFamily,
  }
  const label = { display: 'block', fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8 }
  const onEnter = (fn) => (e) => { if (e.key === 'Enter' && !busy) fn() }

  function body() {
    if (phase === 'loading') return <Loading text='Checking your invitation…' />
    if (phase === 'error') return (
      <div role='alert' style={{ textAlign: 'center' }}>
        <AlertTriangle size={32} color={theme.danger} aria-hidden='true' />
        <p style={{ fontSize: 14, color: gray600, margin: '12px 0 20px' }}>We couldn't check this invitation. Please check your connection and try again.</p>
        <TealBtn onClick={load}>Retry</TealBtn>
      </div>
    )
    if (phase === 'invalid' || phase === 'expired') return (
      <div style={{ textAlign: 'center' }}>
        <MailX size={36} color={gray500} aria-hidden='true' />
        <h1 style={{ fontSize: 18, color: navy, margin: '12px 0 8px' }}>{phase === 'expired' ? 'This invitation has expired' : 'This invitation link is not valid'}</h1>
        <p style={{ fontSize: 14, color: gray600, lineHeight: 1.6, margin: '0 0 20px' }}>
          {phase === 'expired'
            ? `Ask ${invite?.business_name || 'your administrator'} to resend your invitation from their Staff page.`
            : 'It may have been used already, revoked, or replaced by a newer invitation. If you have already joined, just sign in.'}
        </p>
        <Link to='/login' style={{ color: tealDeep, fontWeight: 700, fontSize: 14 }}>Go to sign in</Link>
      </div>
    )

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: fontDisplay, fontSize: 24, fontWeight: 700, color: navy, margin: 0 }}>Join {invite.business_name}</h1>
          <p style={{ fontSize: 14, color: gray600, margin: '6px 0 0', lineHeight: 1.6 }}>
            Hi {invite.full_name}, you've been invited as <strong>{invite.role}</strong>.
          </p>
        </div>

        {signedInAsSomeoneElse && (
          <div role='note' style={{ display: 'flex', gap: 6, padding: '12px 14px', borderRadius: 10, background: theme.warningBg, color: theme.warning, fontSize: 13, lineHeight: 1.5 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
            <span>This browser is signed in as <strong>{sessionEmail}</strong>. Continuing signs that account out here — it is not changed in any way.</span>
          </div>
        )}

        {err && <div role='alert' style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '12px 14px', borderRadius: 10, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: 13, lineHeight: 1.5 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden='true' /> <span>{err}</span></div>}

        <div>
          <label htmlFor='invite-email' style={label}>Email address</label>
          <input id='invite-email' value={invite.email} readOnly style={{ ...fieldStyle, color: gray500 }} />
        </div>

        {invite.account_exists ? (
          signedInAsInvitee ? (
            <>
              <p style={{ fontSize: 13, color: gray600, margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}><UserCheck size={15} aria-hidden='true' /> You're signed in with this email.</p>
              <TealBtn onClick={acceptWithExistingAccount} disabled={busy} style={{ padding: 16, borderRadius: theme.radius.full, fontSize: 15, fontWeight: 800 }}>{busy ? 'Joining…' : 'Accept invitation'}</TealBtn>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: gray600, margin: 0, lineHeight: 1.6 }}>You already have a login with this email. Sign in with your <strong>existing password</strong> to accept — it won't be changed.</p>
              <div>
                <label htmlFor='invite-current-password' style={label}>Your password</label>
                <input id='invite-current-password' type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} onKeyDown={onEnter(acceptWithExistingAccount)} autoComplete='current-password' style={fieldStyle} />
              </div>
              <TealBtn onClick={acceptWithExistingAccount} disabled={busy} style={{ padding: 16, borderRadius: theme.radius.full, fontSize: 15, fontWeight: 800 }}>{busy ? 'Joining…' : 'Sign in & accept'}</TealBtn>
            </>
          )
        ) : (
          <>
            <div>
              <label htmlFor='invite-new-password' style={label}>Choose a password</label>
              <div style={{ position: 'relative' }}>
                <input id='invite-new-password' type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} autoComplete='new-password'
                  aria-describedby='invite-password-hint' style={{ ...fieldStyle, padding: '13px 60px 13px 14px' }} />
                <button type='button' onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', minHeight: 36, padding: '0 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: gray500 }}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              <div id='invite-password-hint' style={{ fontSize: 12, color: gray500, marginTop: 6 }}>At least {MIN_PASSWORD_LENGTH} characters. Only you will know it.</div>
            </div>
            <div>
              <label htmlFor='invite-confirm-password' style={label}>Confirm password</label>
              <input id='invite-confirm-password' type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={onEnter(createAccount)} autoComplete='new-password' style={fieldStyle} />
            </div>
            <TealBtn onClick={createAccount} disabled={busy} style={{ padding: 16, borderRadius: theme.radius.full, fontSize: 15, fontWeight: 800 }}>{busy ? 'Setting up…' : 'Create account & join'}</TealBtn>
          </>
        )}
        <GhostBtn onClick={() => navigate('/')} disabled={busy}>Not now</GhostBtn>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px 16px', boxSizing: 'border-box' }}>
      <main style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Link to='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16, color: theme.gray400, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <ChevronLeft size={15} aria-hidden='true' /> Back to Home
          </Link>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Logo size={56} /></div>
        </div>
        <Card style={{ padding: 28, borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
          {body()}
        </Card>
      </main>
    </div>
  )
}
