import { useEffect, useRef, useState } from 'react'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Inp } from '../../components/ui'

const { gray500, danger, border, tealDeep } = theme

// Strip first, truncate second: pasted `123 456` / `123-456` lands whole as
// `123456`. (Truncating the raw input first via maxLength keeps only 5 digits
// and strands the submit button disabled — the Phase 1 paste fix.)
const cleanOtp = (v) => String(v || '').replace(/\D/g, '').slice(0, 6)

const RESEND_COOLDOWN_SECONDS = 60
const FALLBACK_TTL_SECONDS = 5 * 60
const META_KEY = 'ch-withdrawal-otp-meta'

// Display-only resume across a reload: only the draft id + timestamps, never
// the code/PIN/raw account numbers. The server re-validates everything on
// submit, so a stale or forged value only paints a countdown.
function readOtpMeta() {
  try {
    const raw = sessionStorage.getItem(META_KEY)
    if (!raw) return null
    const m = JSON.parse(raw)
    if (!m || !Number.isFinite(m.otpIssuedAt) || !Number.isFinite(m.draftExpiresAt)) return null
    return { draftId: m.draftId ?? null, otpIssuedAt: m.otpIssuedAt, draftExpiresAt: m.draftExpiresAt }
  } catch {
    return null
  }
}

export function clearWithdrawalOtpMeta() {
  try {
    sessionStorage.removeItem(META_KEY)
  } catch {
    // Display-only key: nothing to clean when storage is unavailable.
  }
}

// The emailed second factor for a withdrawal: the person asks for a code, types it, and the server checks it after the
// PIN and burns it on first use. 60 s between codes, 3 an hour - surfaced from the server's reply.
export default function WithdrawalOtpField({ value, onChange, disabled = false, amount, payoutAccountId, bankCode, accountNumber }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [otpIssuedAt, setOtpIssuedAt] = useState(null)
  const [draftExpiresAt, setDraftExpiresAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const requestedRef = useRef(false)

  // Resume on mount: paint the stored countdown instantly so a reload does not
  // flash the send button, then confirm against the live server draft. PIN/OTP
  // inputs always start empty — a code is never refilled.
  useEffect(() => {
    let cancelled = false
    const meta = readOtpMeta()
    if (meta) {
      setSent(true)
      setOtpIssuedAt(meta.otpIssuedAt)
      setDraftExpiresAt(meta.draftExpiresAt)
    }
    (async () => {
      try {
        const { data: { session } } = await authClient.auth.getSession()
        if (cancelled || !session) return
        const res = await fetch('/api/withdrawal-pin/draft', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled || requestedRef.current) return
        const draft = data && data.draft
        if (draft) {
          const issued = Date.parse(draft.otp_issued_at)
          const expires = Date.parse(draft.draft_expires_at)
          setSent(true)
          if (Number.isFinite(issued)) setOtpIssuedAt(issued)
          if (Number.isFinite(expires)) setDraftExpiresAt(expires)
          try {
            sessionStorage.setItem(META_KEY, JSON.stringify({
              draftId: draft.id ?? null,
              otpIssuedAt: Number.isFinite(issued) ? issued : meta?.otpIssuedAt ?? null,
              draftExpiresAt: Number.isFinite(expires) ? expires : meta?.draftExpiresAt ?? null,
            }))
          } catch {
            // Display-only key: a reload simply re-reads from the server.
          }
        } else if (res.ok) {
          // No live draft and nothing requested this mount: back to the send button.
          setSent(false)
          setOtpIssuedAt(null)
          setDraftExpiresAt(null)
          clearWithdrawalOtpMeta()
        }
      } catch {
        // Keep whatever the stored meta painted; the next mount retries.
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Display-only 1 s tick driving the resend/expiry countdowns.
  useEffect(() => {
    if (!sent) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [sent])

  async function requestCode() {
    requestedRef.current = true
    setError('')
    setSending(true)
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) { setError('Please log in again.'); return }
      // Without an amount the server cannot own a draft, so the body stays
      // exactly `{purpose:'withdrawal'}` as before (backward compatible).
      const body = amount === undefined
        ? { purpose: 'withdrawal' }
        : {
            purpose: 'withdrawal',
            amount,
            ...(payoutAccountId !== undefined ? { payoutAccountId } : {}),
            ...(bankCode !== undefined ? { bankCode } : {}),
            ...(accountNumber !== undefined ? { accountNumber } : {}),
          }
      const res = await fetch('/api/withdrawal-pin/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === 'draft_active') {
        // A code is already on its way: keep the sent state, show the server text.
        setError(data.error || 'A code is already on its way — check your email.')
        setSent(true)
        return
      }
      if (!res.ok) { setError(data.error || 'Could not send the code. Try again.'); return }
      const issuedAt = Date.now()
      const ttlSeconds = typeof data.expiresInSeconds === 'number' && data.expiresInSeconds > 0
        ? data.expiresInSeconds
        : FALLBACK_TTL_SECONDS
      const expiresAt = issuedAt + ttlSeconds * 1000
      setOtpIssuedAt(issuedAt)
      setDraftExpiresAt(expiresAt)
      try {
        sessionStorage.setItem(META_KEY, JSON.stringify({
          draftId: data.draftId ?? data.draft_id ?? null,
          otpIssuedAt: issuedAt,
          draftExpiresAt: expiresAt,
        }))
      } catch {
        // Display-only key: a reload simply re-reads from the server.
      }
      setSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const resendIn = otpIssuedAt == null
    ? 0
    : Math.max(0, Math.ceil((otpIssuedAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000))
  const remainingMs = draftExpiresAt == null ? null : Math.max(0, draftExpiresAt - now)
  const expiresIn = remainingMs == null
    ? null
    : `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`

  if (!sent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button type="button" onClick={requestCode} disabled={sending || disabled}
          style={{ padding: '10px 12px', borderRadius: 8, border: `1px dashed ${border}`, background: 'none', color: tealDeep, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          {sending ? 'Sending...' : 'Email me a 6-digit code'}
        </button>
        <span style={{ fontSize: '11px', color: gray500 }}>We&apos;ll email you a code to confirm it&apos;s you (up to 3 an hour).</span>
        {error && <span role="alert" style={{ fontSize: '12px', color: danger, fontWeight: 700 }}>{error}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Inp
        id="otp-withdrawal"
        label="Email verification code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        autoComplete="one-time-code"
        value={value}
        onChange={(v) => onChange(cleanOtp(v))}
        onPaste={(e) => { e.preventDefault(); onChange(cleanOtp(e.clipboardData?.getData('text') ?? '')) }}
        placeholder="6-digit code"
        disabled={disabled}
        required
      />
      <span role="status" style={{ fontSize: '11px', color: gray500 }}>
        {expiresIn == null
          ? 'Code sent - check your email. It expires in 5 minutes.'
          : `Code sent · expires in ${expiresIn} · resend in ${resendIn} s`}
      </span>
      {resendIn > 0 ? (
        <button type="button" disabled
          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: '12px', fontWeight: 700, color: gray500, fontFamily: 'inherit' }}>
          {`Resend available in ${resendIn}s`}
        </button>
      ) : (
        <>
          <button type="button" onClick={requestCode} disabled={sending || disabled}
            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: '12px', fontWeight: 700, color: tealDeep, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
            {sending ? 'Sending...' : 'Send a new code'}
          </button>
          <span style={{ fontSize: '11px', color: gray500 }}>Requesting a new code voids the previous one.</span>
        </>
      )}
      {error && <span role="alert" style={{ fontSize: '12px', color: danger, fontWeight: 700 }}>{error}</span>}
    </div>
  )
}
