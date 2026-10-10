import { useState } from 'react'
import { supabase } from '../../config/supabaseClient.js'
import { theme } from '../../styles/theme.js'
import { Inp } from '../../components/ui/index.jsx'

// The emailed second factor for a withdrawal: the person asks for a code, types it, and the server checks it after the
// PIN and burns it on first use. 60 s between codes, 3 an hour - surfaced from the server's reply.
export default function WithdrawalOtpField({ value, onChange, disabled = false }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function requestCode() {
    setError('')
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Please log in again.'); return }
      const res = await fetch('/api/withdrawal-pin/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ purpose: 'withdrawal' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send the code. Try again.'); return }
      setSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (!sent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={requestCode} disabled={sending || disabled}
          style={{ padding: '10px 12px', borderRadius: 12, border: `1px dashed ${theme.border}`, background: 'none', color: theme.tealDeep, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          {sending ? 'Sending…' : 'Email me a 6-digit code'}
        </button>
        <span style={{ fontSize: 11, color: theme.textLight }}>We&apos;ll email you a code to confirm it&apos;s you (up to 3 an hour).</span>
        {error && <span role="alert" style={{ fontSize: 12, color: theme.danger, fontWeight: 700 }}>{error}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Inp
        id="otp-withdrawal"
        label="Email verification code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        value={value}
        onChange={(v) => onChange(String(v || '').replace(/\D/g, '').slice(0, 6))}
        placeholder="6-digit code"
        disabled={disabled}
        required
      />
      <span role="status" style={{ fontSize: 11, color: theme.textLight }}>
        Code sent — check your email. It expires in 5 minutes.
      </span>
      <button type="button" onClick={requestCode} disabled={sending || disabled}
        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 12, fontWeight: 800, color: theme.tealDeep, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
        {sending ? 'Sending…' : 'Send a new code'}
      </button>
      {error && <span role="alert" style={{ fontSize: 12, color: theme.danger, fontWeight: 700 }}>{error}</span>}
    </div>
  )
}
