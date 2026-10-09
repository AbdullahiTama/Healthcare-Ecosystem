import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPinSetup } from '@care-ecosystem/shared-payout-ui'
import { supabase } from '../../config/supabaseClient.js'
import { theme } from '../../styles/theme.js'
import { Inp, Modal, TealBtn, GhostBtn } from '../../components/ui/index.jsx'

const RESEND_SECONDS = 60

// Set, change or reset the withdrawal PIN. A signed-in session alone is never
// enough: step 1 emails a 6-digit code, step 2 takes the new PIN + that code
// (+ the current PIN when replacing one, unless "I forgot my PIN").
export default function WithdrawalPinModal({ show, onClose, onDone, isMobile }) {
  const setup = useMemo(
    () => createPinSetup({ getToken: async () => (await supabase.auth.getSession()).data.session?.access_token }),
    [],
  )
  const s = useSyncExternalStore(setup.subscribe, setup.getState)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [otp, setOtp] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [forgot, setForgot] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (!show) {
      setup.reset(); setPin(''); setConfirmPin(''); setOtp(''); setCurrentPin(''); setForgot(false); setResendIn(0)
    }
  }, [show, setup])

  useEffect(() => {
    if (resendIn <= 0) return undefined
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  async function sendCode() {
    if (await setup.sendCode()) setResendIn(RESEND_SECONDS)
  }

  async function save() {
    if (await setup.submit({ pin, confirmPin, otp, currentPin: forgot ? undefined : currentPin || undefined, forgot })) onDone()
  }

  const digits = { type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6 }

  return (
    <Modal
      show={show}
      onClose={onClose}
      title="Withdrawal PIN"
      sheet={isMobile}
      footer={
        <>
          <GhostBtn onClick={onClose} style={{ flex: 1 }}>Cancel</GhostBtn>
          {s.codeSent
            ? <TealBtn onClick={save} disabled={s.submitting || !pin || !confirmPin || !otp} style={{ flex: 1 }}>{s.submitting ? 'Saving…' : 'Save PIN'}</TealBtn>
            : <TealBtn onClick={sendCode} disabled={s.sending} style={{ flex: 1 }}>{s.sending ? 'Sending…' : 'Email me a code'}</TealBtn>}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!s.codeSent ? (
          <p style={{ margin: 0, fontSize: 12.5, color: theme.textMid, lineHeight: 1.6 }}>
            To protect your money, we’ll email a 6-digit code to your account email before you can set or change your PIN.
            You’ll enter the PIN every time you withdraw.
          </p>
        ) : (
          <>
            <p role="status" style={{ margin: 0, fontSize: 12.5, color: theme.textMid, lineHeight: 1.6 }}>
              Code sent to <strong>{s.sentTo || 'your email'}</strong>. It expires in 5 minutes.{' '}
              <button type="button" onClick={sendCode} disabled={resendIn > 0 || s.sending} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, color: resendIn > 0 ? theme.textLight : theme.tealDeep, cursor: resendIn > 0 ? 'default' : 'pointer' }}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </p>
            <Inp label="6-digit code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(v) => setOtp(v.replace(/\D/g, ''))} placeholder="123456" required />
            {!forgot && <Inp label="Current PIN (skip if you’ve never set one)" {...digits} value={currentPin} onChange={setCurrentPin} autoComplete="current-password" />}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: theme.textMid, minHeight: 32 }}>
              <input type="checkbox" checked={forgot} onChange={(e) => setForgot(e.target.checked)} />
              I forgot my current PIN
            </label>
            <Inp label="New PIN" {...digits} value={pin} onChange={setPin} placeholder="4-6 digits" autoComplete="new-password" required />
            <Inp label="Confirm new PIN" {...digits} value={confirmPin} onChange={setConfirmPin} placeholder="Repeat your PIN" autoComplete="new-password" required />
          </>
        )}
        {s.error && <p role="alert" style={{ margin: 0, fontSize: 12, color: theme.danger, fontWeight: 700 }}>{s.error}</p>}
      </div>
    </Modal>
  )
}
