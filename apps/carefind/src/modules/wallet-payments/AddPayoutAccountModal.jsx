import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createAccountResolver } from '@care-ecosystem/shared-payout-ui'
import { supabase } from '../../config/supabaseClient.js'
import { theme } from '../../styles/theme.js'
import { Inp, Modal, TealBtn, GhostBtn } from '../../components/ui/index.jsx'
import BankPicker from './BankPicker.jsx'

const RESEND_SECONDS = 60

// Save a bank account to be paid into. The bank tells us the account name; it must match the verified BVN name, and an
// emailed code proves the inbox. The server enforces all of it - this form only walks the person through.
export default function AddPayoutAccountModal({ show, onClose, manager, banks, banksStatus, onRetryBanks, isMobile }) {
  const resolver = useMemo(() => createAccountResolver({ getToken: async () => (await supabase.auth.getSession()).data.session?.access_token }), [])
  const acct = useSyncExternalStore(resolver.subscribe, resolver.getState)
  const s = useSyncExternalStore(manager.subscribe, manager.getState)
  const [otp, setOtp] = useState('')
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => { if (!show) { resolver.reset(); setOtp(''); setResendIn(0) } }, [show, resolver])
  useEffect(() => {
    if (resendIn <= 0) return undefined
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  async function sendCode() {
    if (await manager.sendCode()) setResendIn(RESEND_SECONDS)
  }
  async function save() {
    if (await manager.addAccount({ bankCode: acct.bankCode, accountNumber: acct.accountNumber, otp })) onClose()
  }

  const canSend = acct.status === 'ok' && s.busy !== 'otp'
  const mismatch = s.code === 'name_mismatch'

  return (
    <Modal
      show={show}
      onClose={onClose}
      title="Add a payout account"
      sheet={isMobile}
      footer={
        <>
          <GhostBtn onClick={onClose} style={{ flex: 1 }}>Cancel</GhostBtn>
          {s.codeSent
            ? <TealBtn onClick={save} disabled={s.busy === 'add' || otp.length !== 6 || acct.status !== 'ok'} style={{ flex: 1 }}>{s.busy === 'add' ? 'Saving…' : 'Save account'}</TealBtn>
            : <TealBtn onClick={sendCode} disabled={!canSend} style={{ flex: 1 }}>{s.busy === 'otp' ? 'Sending…' : 'Email me a code'}</TealBtn>}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: theme.textMid, lineHeight: 1.6 }}>
          The account must be in <strong>your own name</strong> (as on your BVN). You can save up to 5.
        </p>
        <BankPicker banks={banks} status={banksStatus} selectedCode={acct.bankCode} onSelect={(b) => resolver.setBank(b ? b.code : '')} onRetry={onRetryBanks} />
        <Inp id="payout-acct-number" label="Account number" inputMode="numeric" maxLength={10} autoComplete="off" value={acct.accountNumber} onChange={(v) => resolver.setAccountNumber(v)} placeholder="10-digit account number" required />
        <div role="status" aria-live="polite" style={{ minHeight: 38, display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: 12, background: acct.status === 'ok' ? theme.tealMist : theme.gray50, fontSize: 13 }}>
          {acct.status === 'idle' && <span style={{ color: theme.textLight }}>Account name appears here once the bank confirms it.</span>}
          {acct.status === 'loading' && <span style={{ color: theme.textMid }}>Confirming account…</span>}
          {acct.status === 'ok' && <span style={{ color: theme.tealDeep, fontWeight: 800 }}>{acct.accountName}</span>}
          {acct.status === 'unsupported' && <span style={{ color: theme.danger, fontWeight: 700 }}>This bank can’t be verified automatically, so it can’t be saved. Choose another account.</span>}
          {acct.status === 'error' && <span style={{ color: theme.danger, fontWeight: 700 }}>{acct.error}</span>}
        </div>

        {s.codeSent && (
          <>
            <p role="status" style={{ margin: 0, fontSize: 12.5, color: theme.textMid }}>
              Code sent to <strong>{s.sentTo || 'your email'}</strong> (valid 5 minutes).{' '}
              <button type="button" onClick={sendCode} disabled={resendIn > 0 || s.busy === 'otp'} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, color: resendIn > 0 ? theme.textLight : theme.tealDeep, cursor: resendIn > 0 ? 'default' : 'pointer' }}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </p>
            <Inp id="payout-otp" label="6-digit code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={otp} onChange={(v) => setOtp(String(v).replace(/\D/g, '').slice(0, 6))} />
          </>
        )}

        {s.error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: theme.danger, fontWeight: 700 }}>
            {s.error}{mismatch && ' Use the account that carries your own name.'}
          </p>
        )}
      </div>
    </Modal>
  )
}
