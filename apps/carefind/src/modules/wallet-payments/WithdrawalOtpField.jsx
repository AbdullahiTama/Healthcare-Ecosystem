import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanOtp, readClipboardOtp } from '@care-ecosystem/shared-payout-ui'
import { supabase } from '../../config/supabaseClient.js'
import { theme } from '../../styles/theme.js'
import { Inp } from '../../components/ui/index.jsx'

const RESEND_COOLDOWN_SECONDS = 60
const FALLBACK_TTL_SECONDS = 5 * 60
const META_KEY = 'cf-withdrawal-otp-meta'

// Display-only resume across a reload: only the draft id + timestamps, never
// the code/PIN/raw account numbers. The server re-validates everything on
// submit, so a stale or forged value only paints a countdown.
function readOtpMeta() {
  try {
    const raw = sessionStorage.getItem(META_KEY)
    if (!raw) return null
    const m = JSON.parse(raw)
    if (!m || !Number.isFinite(m.otpIssuedAt) || !Number.isFinite(m.otpExpiresAt)) return null
    return { draftId: m.draftId ?? null, otpIssuedAt: m.otpIssuedAt, otpExpiresAt: m.otpExpiresAt }
  } catch {
    return null
  }
}

function writeOtpMeta(meta) {
  try {
    sessionStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // Display-only key: a reload simply re-reads from the server.
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
//
// Resume contract: the server owns the amount + destination the code was issued for. This component may therefore be
// REMOUNTED at any time (the router keys its routes on location.key, so any in-app navigation remounts, and a deploy
// while the user is in their mail app forces a document reload). It must rebuild from the server draft instead of
// assuming the form it was holding still exists.
export default function WithdrawalOtpField({
  value, onChange, disabled = false, amount, payoutAccountId, bankCode, accountNumber, onResume,
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [otpIssuedAt, setOtpIssuedAt] = useState(null)
  const [otpExpiresAt, setOtpExpiresAt] = useState(null)
  const [resumed, setResumed] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const requestedRef = useRef(false)

  // The server only owns a draft (and issues a code) when the request names an
  // amount AND a destination. Until both props arrive the field shows a hint
  // instead of the request button.
  const hasDestination = Boolean(payoutAccountId) || (Boolean(bankCode) && Boolean(accountNumber))
  const canRequest = amount !== undefined && hasDestination
  const requestKey = JSON.stringify([amount ?? null, payoutAccountId ?? null, bankCode ?? null, accountNumber ?? null])

  // The request key the code on screen was actually issued for. `null` means "we have not
  // established one yet" - which is the state right after a resume, while the form is still
  // being rebuilt. Only a NON-null key may be invalidated.
  const issuedKeyRef = useRef(null)

  const adoptDraft = useCallback((draft, issuedAt, expiresAtMs) => {
    if (draft) {
      setResumed({ amount: draft.amount, unit: draft.unit, destinationKind: draft.destinationKind, savedAccountId: draft.savedAccountId, destinationMask: draft.destination_mask })
      if (typeof onResume === 'function') onResume(draft)
    }
    setSent(true)
    setOtpIssuedAt(issuedAt)
    setOtpExpiresAt(expiresAtMs)
    writeOtpMeta({ draftId: draft?.id ?? null, otpIssuedAt: issuedAt, otpExpiresAt: expiresAtMs })
  }, [onResume])

  // Resume on mount: paint the stored countdown instantly so a reload does not
  // flash the send button, then confirm against the live server draft. PIN/OTP
  // inputs always start empty - a code is never refilled.
  useEffect(() => {
    let cancelled = false
    const meta = readOtpMeta()
    if (meta) {
      setSent(true)
      setOtpIssuedAt(meta.otpIssuedAt)
      setOtpExpiresAt(meta.otpExpiresAt)
    }
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled || !session) return
        const res = await fetch('/api/withdrawal-pin/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: '{}',
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled || requestedRef.current) return
        const draft = data && data.draft
        if (draft) {
          const issued = Date.parse(draft.otp_issued_at)
          // The countdown shows when the CODE dies, not when the draft does. A draft lives 10
          // minutes and a code 5, so painting the draft's expiry promised up to five extra
          // minutes and then failed the user with "that code has expired".
          const expires = Date.parse(draft.otpExpiresAt) || (Date.parse(draft.otp_issued_at) + FALLBACK_TTL_SECONDS * 1000)
          adoptDraft(draft, Number.isFinite(issued) ? issued : meta?.otpIssuedAt ?? null, expires)
        } else if (res.ok) {
          // No live draft and nothing requested this mount: back to the send button.
          setSent(false)
          setResumed(null)
          setOtpIssuedAt(null)
          setOtpExpiresAt(null)
          clearWithdrawalOtpMeta()
        }
      } catch {
        // Keep whatever the stored meta painted; the next mount retries.
      }
    })()
    return () => { cancelled = true }
  }, [adoptDraft])

  // Adopt the request key only once the form genuinely matches the code on screen. While that is
  // still false the user is REBUILDING the form (the amount arrives from the draft, a saved
  // account is re-selected), and every keystroke used to change the key and wipe the session -
  // which is how a user who switched to their mail and came back found the code they had just
  // read had been thrown away.
  useEffect(() => {
    if (!sent || !resumed) return
    if (resumed.unit === 'coins' && Number(amount) !== Number(resumed.amount)) return
    if (resumed.destinationKind !== 'saved' || !resumed.savedAccountId || payoutAccountId !== resumed.savedAccountId) return
    issuedKeyRef.current = requestKey
  }, [sent, resumed, amount, payoutAccountId, requestKey])

  // A genuine edit AFTER a code was issued for this exact form: the code belongs to the old
  // draft, so a fresh one is required. The server gate enforces this regardless.
  useEffect(() => {
    if (issuedKeyRef.current !== null && issuedKeyRef.current !== requestKey) {
      issuedKeyRef.current = null
      setSent(false)
      setResumed(null)
      setOtpIssuedAt(null)
      setOtpExpiresAt(null)
      setError('')
      clearWithdrawalOtpMeta()
      onChange('')
    }
  }, [requestKey, onChange])

  // Display-only 1 s tick driving the resend/expiry countdowns.
  useEffect(() => {
    if (!sent) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [sent])

  async function requestCode(reissue = false) {
    requestedRef.current = true
    setError('')
    setPasteError('')
    setSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Please log in again.'); return }
      // The server owns the amount + destination in a draft first. An explicit
      // re-press after the cooldown voids the prior code (reissue:true).
      const body = amount === undefined
        ? { purpose: 'withdrawal', ...(reissue ? { reissue: true } : {}) }
        : {
            purpose: 'withdrawal',
            amount,
            ...(payoutAccountId !== undefined ? { payoutAccountId } : {}),
            ...(bankCode !== undefined ? { bankCode } : {}),
            ...(accountNumber !== undefined ? { accountNumber } : {}),
            ...(reissue ? { reissue: true } : {}),
          }
      const res = await fetch('/api/withdrawal-pin/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === 'draft_active') {
        // A code is already on its way and NO new one was sent. The body now carries that
        // code's issue time and expiry, so adopt the live draft instead of blanking the
        // countdown - otherwise the cooldown read 0 and "Send a new code" was live
        // immediately, and one tap voided the code already in the inbox.
        setError(data.error || 'A code is already on its way. Check your email.')
        const issuedAt = Number.isFinite(data.otpIssuedAt) ? data.otpIssuedAt : null
        const expiresAt = issuedAt && Number.isFinite(data.expiresInSeconds)
          ? issuedAt + data.expiresInSeconds * 1000
          : (Date.parse(data.otpExpiresAt) || null)
        setResumed(null)
        issuedKeyRef.current = null
        adoptDraft(
          { id: data.draftId, amount: data.amount, unit: data.unit, destinationKind: data.destinationKind, savedAccountId: data.savedAccountId, destination_mask: data.destinationMask },
          issuedAt ?? otpIssuedAt,
          expiresAt ?? otpExpiresAt,
        )
        return
      }
      if (!res.ok) { setError(data.error || 'Could not send the code. Try again.'); return }
      const issuedAt = Date.now()
      const ttlSeconds = typeof data.expiresInSeconds === 'number' && data.expiresInSeconds > 0
        ? data.expiresInSeconds
        : FALLBACK_TTL_SECONDS
      setResumed(null)
      adoptDraft(null, issuedAt, issuedAt + ttlSeconds * 1000)
      issuedKeyRef.current = requestKey
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  // Clipboard paste is the only autofill that reliably works for an EMAIL-delivered code: the
  // WebOTP API is Chrome/Android and SMS-only, and `autocomplete="one-time-code"` support for
  // mail-delivered codes is partial. Reading the clipboard must come from a user gesture, so
  // this is wired to the button below rather than run on mount.
  async function pasteFromClipboard() {
    setPasteError('')
    const code = await readClipboardOtp()
    if (!code) { setPasteError('No 6-digit code found on the clipboard. Type it instead.'); return }
    onChange(code)
  }

  const resendIn = otpIssuedAt == null
    ? 0
    : Math.max(0, Math.ceil((otpIssuedAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000))
  const remainingMs = otpExpiresAt == null ? null : Math.max(0, otpExpiresAt - now)
  const expiresIn = remainingMs == null
    ? null
    : `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`

  if (!sent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {canRequest ? (
          <button type="button" onClick={() => requestCode()} disabled={sending || disabled}
            style={{ padding: '10px 12px', borderRadius: 12, border: `1px dashed ${theme.border}`, background: 'none', color: theme.tealDeep, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            {sending ? 'Sending…' : 'Email me a 6-digit code'}
          </button>
        ) : (
          <span style={{ fontSize: 12, color: theme.textLight }}>Choose an amount and destination first.</span>
        )}
        <span style={{ fontSize: 11, color: theme.textLight }}>We&apos;ll email you a code to confirm it&apos;s you (up to 3 an hour).</span>
        {error && <span role="alert" style={{ fontSize: 12, color: theme.danger, fontWeight: 700 }}>{error}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Inp
        id="otp-withdrawal"
        name="one-time-code"
        label="Email verification code"
        type="text"
        inputMode="numeric"
        pattern="[0-9]{6}"
        autoComplete="one-time-code"
        enterKeyHint="done"
        autoFocus
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={(v) => onChange(cleanOtp(v))}
        onPaste={(e) => { e.preventDefault(); const pasted = cleanOtp(e.clipboardData?.getData('text') ?? ''); if (pasted) onChange(pasted) }}
        placeholder="123456"
        disabled={disabled}
        aria-describedby="otp-withdrawal-status"
        required
      />
      <span id="otp-withdrawal-status" role="status" style={{ fontSize: 11, color: theme.textLight }}>
        {expiresIn == null
          ? 'Code sent. Check your email. It expires in 5 minutes.'
          : `Code sent · expires in ${expiresIn} · resend in ${resendIn} s`}
      </span>
      <span style={{ fontSize: 11, color: theme.textLight }}>
        Your device may offer the code automatically. If it doesn&apos;t, paste it below or type it out.
      </span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={pasteFromClipboard} disabled={disabled}
          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 12, fontWeight: 800, color: theme.tealDeep, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
          Paste code from clipboard
        </button>
        {pasteError && <span role="alert" style={{ fontSize: 11, color: theme.danger, fontWeight: 700 }}>{pasteError}</span>}
      </div>
      {resendIn > 0 ? (
        <button type="button" disabled
          style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 12, fontWeight: 800, color: theme.textLight, fontFamily: 'inherit' }}>
          {`Resend available in ${resendIn}s`}
        </button>
      ) : (
        <>
          <button type="button" onClick={() => requestCode(true)} disabled={sending || disabled}
            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 12, fontWeight: 800, color: theme.tealDeep, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
            {sending ? 'Sending…' : 'Send a new code'}
          </button>
          <span style={{ fontSize: 11, color: theme.textLight }}>Requesting a new code voids the previous one.</span>
        </>
      )}
      {error && <span role="alert" style={{ fontSize: 12, color: theme.danger, fontWeight: 700 }}>{error}</span>}
    </div>
  )
}