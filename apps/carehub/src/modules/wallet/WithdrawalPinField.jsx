import { useEffect, useState } from 'react'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Inp, GhostBtn, TealBtn } from '../../components/ui'

const { gray500, danger, success, border } = theme

const isPin = (v) => /^\d{4,6}$/.test(String(v || ''))

async function pinRequest(action, body) {
  const { data: { session } } = await authClient.auth.getSession()
  if (!session) return { ok: false, status: 401, data: { error: 'Please log in again.' } }
  const res = await fetch(`/api/withdrawal-pin/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// The second factor for a business withdrawal (audit F-08): the owner's withdrawal PIN. Shown inside the withdraw
// forms of both the Wallet and Appointments screens. A PIN is per person (one PIN also protects the same person's
// CareFind withdrawals). Changing an existing PIN needs the current one, so a stolen session cannot replace it.
//
// States: idle (just the PIN field), setting (the create/change form), saving, error, saved.
export default function WithdrawalPinField({ pin, onPinChange, needsPin = false, disabled = false }) {
  const [setting, setSetting] = useState(false)
  const [hasPin, setHasPin] = useState(null) // null = not asked yet
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // The server said no PIN exists yet: take the owner straight to creating one.
  useEffect(() => { if (needsPin) openSetting() }, [needsPin])

  async function openSetting() {
    setSetting(true); setError(''); setSaved(false)
    if (hasPin === null) {
      const r = await pinRequest('status')
      setHasPin(r.ok ? Boolean(r.data.hasPin) : needsPin ? false : null)
    }
  }

  async function save() {
    setError('')
    if (!isPin(next)) { setError('Your PIN must be 4 to 6 digits.'); return }
    if (next !== confirm) { setError('The two PINs do not match.'); return }
    if (hasPin && !isPin(current)) { setError('Enter your current PIN to change it.'); return }
    setSaving(true)
    try {
      const r = await pinRequest('set', { pin: next, currentPin: hasPin ? current : undefined })
      if (!r.ok) { setError(r.data.error || 'Could not save your PIN.'); return }
      setHasPin(true); setSaved(true); setSetting(false)
      setCurrent(''); setNext(''); setConfirm('')
      onPinChange?.(next)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const digits = (v) => String(v || '').replace(/\D/g, '').slice(0, 6)

  return (
    <div>
      <Inp
        label="Withdrawal PIN"
        type="password"
        value={pin || ''}
        onChange={(v) => onPinChange?.(digits(v))}
        placeholder="4-6 digits"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        disabled={disabled}
        required
      />
      {saved && !setting && <span role="status" style={{ fontSize: '11px', color: success, fontWeight: '700' }}>✓ PIN saved</span>}
      {!setting && (
        <button type="button" onClick={openSetting} disabled={disabled}
          style={{ background: 'none', border: 'none', padding: '4px 0', fontSize: '12px', fontWeight: 700, color: theme.tealDeep, cursor: 'pointer', textDecoration: 'underline' }}>
          {hasPin === false || needsPin ? 'Set your withdrawal PIN' : 'Set or change PIN'}
        </button>
      )}

      {setting && (
        <div style={{ marginTop: '8px', padding: '12px', border: `1px solid ${border}`, borderRadius: theme.radius?.md || 8, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '12px', color: gray500 }}>
            {needsPin && hasPin !== true ? 'Withdrawals need a PIN. Choose one now.' : hasPin ? 'Change your withdrawal PIN.' : 'Choose a withdrawal PIN.'} It also protects your CareFind withdrawals.
          </div>
          {hasPin && <Inp label="Current PIN" type="password" value={current} onChange={(v) => setCurrent(digits(v))} inputMode="numeric" autoComplete="off" maxLength={6} />}
          <Inp label="New PIN" type="password" value={next} onChange={(v) => setNext(digits(v))} placeholder="4-6 digits" inputMode="numeric" autoComplete="new-password" maxLength={6} />
          <Inp label="Confirm new PIN" type="password" value={confirm} onChange={(v) => setConfirm(digits(v))} inputMode="numeric" autoComplete="new-password" maxLength={6} />
          {error && <span role="alert" style={{ fontSize: '12px', color: danger, fontWeight: 700 }}>{error}</span>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <GhostBtn type="button" onClick={() => { setSetting(false); setError('') }} disabled={saving} style={{ flex: 1, padding: '10px' }}>Cancel</GhostBtn>
            <TealBtn type="button" onClick={save} disabled={saving} style={{ flex: 1, padding: '10px', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save PIN'}</TealBtn>
          </div>
        </div>
      )}
    </div>
  )
}
