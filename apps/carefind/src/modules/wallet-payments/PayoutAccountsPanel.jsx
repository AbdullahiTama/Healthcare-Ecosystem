import { useState, useSyncExternalStore } from 'react'
import { ShieldCheck, Landmark, Trash2, Star } from 'lucide-react'
import { theme } from '../../styles/theme.js'
import { Inp, TealBtn, GhostBtn } from '../../components/ui/index.jsx'
import { formatKobo, prepareSelfie } from '@care-ecosystem/shared-payout-ui'
import AddPayoutAccountModal from './AddPayoutAccountModal.jsx'

const box = { border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: '#fff' }
const linkBtn = { background: 'none', border: 'none', padding: '6px 0', minHeight: 32, color: theme.tealDeep, fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }

// Identity (BVN + NIN) and the owner's saved, verified payout accounts. Withdrawals can only go to one of these
// (and, once the platform requires it, ONLY to one of these). `manager` is the shared createPayoutManager store.
export default function PayoutAccountsPanel({ manager, selectedId, onSelect, banks, banksStatus, onRetryBanks, isMobile, showSelfie = false }) {
  const s = useSyncExternalStore(manager.subscribe, manager.getState)
  const [bvn, setBvn] = useState('')
  const [nin, setNin] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [removePin, setRemovePin] = useState('')
  const [selfieBvn, setSelfieBvn] = useState('')
  const [selfieFile, setSelfieFile] = useState(null)
  const [selfieError, setSelfieError] = useState('')
  const digits = (v) => String(v || '').replace(/\D/g, '').slice(0, 11)

  if (s.loading) {
    return <div style={box} role="status" aria-busy="true"><div style={{ height: 14, width: '55%', background: theme.gray100, borderRadius: 6 }} /><div style={{ height: 40, background: theme.gray100, borderRadius: 10, marginTop: 12 }} /></div>
  }
  if (s.loadError) {
    return (
      <div style={box} role="alert">
        <p style={{ margin: '0 0 8px', fontSize: 13, color: theme.danger, fontWeight: 700 }}>{s.loadError}</p>
        <GhostBtn onClick={manager.load}>Try again</GhostBtn>
      </div>
    )
  }

  const verified = Boolean(s.kyc?.verified)

  async function verify(e) {
    e.preventDefault()
    if (await manager.verifyIdentity({ bvn, nin })) { setBvn(''); setNin('') }
  }

  async function submitSelfie(e) {
    e.preventDefault()
    setSelfieError('')
    try {
      const selfieImage = await prepareSelfie(selfieFile)
      if (await manager.verifySelfie({ bvn: selfieBvn, selfieImage })) { setSelfieBvn(''); setSelfieFile(null) }
    } catch (err) {
      setSelfieError(err.message)
    }
  }

  async function confirmRemove() {
    if (await manager.remove({ id: removing, pin: removePin })) { setRemoving(null); setRemovePin('') }
  }

  return (
    <section aria-label="Payout accounts" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
      {/* 1. identity */}
      {verified ? (
        <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 10, background: theme.tealMist }}>
          <ShieldCheck size={18} color={theme.tealDeep} aria-hidden="true" />
          <div style={{ fontSize: 12.5, color: theme.tealDeep }}>
            <strong>Identity verified</strong> — {s.kyc.legalName}
            <span style={{ opacity: 0.75 }}> · BVN ••••{s.kyc.bvnLast4}</span>
          </div>
        </div>
      ) : (
        <form onSubmit={verify} style={{ ...box, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>Verify your identity</div>
          <p style={{ margin: 0, fontSize: 12, color: theme.textMid, lineHeight: 1.6 }}>
            To keep your money safe, withdrawals only go to a bank account in your own name. Enter your BVN and NIN once.
            We check them with our identity partner and never store the numbers.
          </p>
          <Inp id="kyc-bvn" label="BVN (11 digits)" type="password" inputMode="numeric" autoComplete="off" maxLength={11} value={bvn} onChange={(v) => setBvn(digits(v))} />
          <Inp id="kyc-nin" label="NIN (11 digits)" type="password" inputMode="numeric" autoComplete="off" maxLength={11} value={nin} onChange={(v) => setNin(digits(v))} />
          {s.error && s.busy === '' && !adding && <p role="alert" style={{ margin: 0, fontSize: 12, color: theme.danger, fontWeight: 700 }}>{s.error}</p>}
          <TealBtn type="submit" disabled={s.busy === 'verify' || bvn.length !== 11 || nin.length !== 11}>{s.busy === 'verify' ? 'Verifying…' : 'Verify identity'}</TealBtn>
        </form>
      )}


      {/* 1b. what the person can withdraw, and how to raise it */}
      {verified && s.limits && s.limits.dailyCapKobo != null && (
        <div style={{ ...box, fontSize: 12.5, color: theme.textMid }}>
          <strong>Verification limit: {formatKobo(s.limits.dailyCapKobo)} a day</strong>
          {s.limits.tier >= 2 && <span> · selfie verified</span>}
          <span> (your account history may set a lower daily limit)</span>
          {showSelfie && s.limits.tier === 1 && s.limits.nextTierCapKobo && (
            <form onSubmit={submitSelfie} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              <div>A selfie check raises your verification limit to <strong>{formatKobo(s.limits.nextTierCapKobo)}</strong> a day.</div>
              <Inp id="selfie-bvn" label="BVN (11 digits)" type="password" inputMode="numeric" autoComplete="off" maxLength={11} value={selfieBvn} onChange={(v) => setSelfieBvn(digits(v))} />
              <label htmlFor="selfie-file" style={{ fontSize: 11, fontWeight: 700 }}>Photo of your face</label>
              <input id="selfie-file" type="file" accept="image/*" capture="user" onChange={(e) => setSelfieFile(e.target.files?.[0] || null)} />
              {(selfieError || (s.error && s.busy === '' && ['selfie_mismatch', 'id_mismatch', 'no_photo', 'kyc_unavailable'].includes(s.code))) && (
                <p role="alert" style={{ margin: 0, fontSize: 12, color: theme.danger, fontWeight: 700 }}>{selfieError || s.error}</p>
              )}
              <TealBtn type="submit" disabled={s.busy === 'selfie' || selfieBvn.length !== 11 || !selfieFile}>{s.busy === 'selfie' ? 'Checking…' : 'Verify selfie'}</TealBtn>
            </form>
          )}
        </div>
      )}

      {/* 2. accounts */}
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>Payout accounts</div>
          <button type="button" style={{ ...linkBtn, opacity: verified ? 1 : 0.5 }} disabled={!verified} onClick={() => { manager.clearError(); setAdding(true) }}>+ Add account</button>
        </div>

        {s.accounts.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12.5, color: theme.textLight, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Landmark size={16} aria-hidden="true" />
            {verified ? 'No payout account yet. Add the bank account you want to be paid into.' : 'Verify your identity, then add your bank account.'}
          </p>
        ) : (
          <div role="radiogroup" aria-label="Withdraw to" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {s.accounts.map((a) => (
              <div key={a.id} style={{ border: `1px solid ${a.id === selectedId ? theme.tealDeep : theme.border}`, borderRadius: 12, padding: '10px 12px', background: a.id === selectedId ? theme.tealMist : '#fff' }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', minHeight: 44 }}>
                  <input type="radio" name="payout-account" checked={a.id === selectedId} onChange={() => onSelect(a.id)} style={{ marginTop: 4 }} />
                  <span style={{ fontSize: 13, color: theme.navy }}>
                    <strong>{a.bankName}</strong> ••••{a.accountLast4}
                    {a.isDefault && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: theme.tealDeep }}>DEFAULT</span>}
                    <br /><span style={{ fontSize: 12, color: theme.textMid }}>{a.accountName}</span>
                  </span>
                </label>
                {a.coolingEndsAt && s.limits && (
                  <div role="note" style={{ fontSize: 11.5, color: theme.textMid, margin: '2px 0 4px 26px' }}>
                    New account: withdrawals are limited to {formatKobo(s.limits.cooloffCapKobo)} in any 24 hours until {new Date(a.coolingEndsAt).toLocaleString()}.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14 }}>
                  {!a.isDefault && <button type="button" style={linkBtn} onClick={() => manager.setDefault(a.id)} disabled={s.busy === 'default'}><Star size={12} aria-hidden="true" /> Make default</button>}
                  <button type="button" style={{ ...linkBtn, color: theme.danger }} onClick={() => { manager.clearError(); setRemoving(a.id); setRemovePin('') }}><Trash2 size={12} aria-hidden="true" /> Remove</button>
                </div>
                {removing === a.id && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Inp id={`rm-pin-${a.id}`} label="Withdrawal PIN to confirm" type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={removePin} onChange={(v) => setRemovePin(String(v).replace(/\D/g, '').slice(0, 6))} />
                    {s.error && <p role="alert" style={{ margin: 0, fontSize: 12, color: theme.danger, fontWeight: 700 }}>{s.error}</p>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <GhostBtn onClick={() => setRemoving(null)} style={{ flex: 1 }}>Cancel</GhostBtn>
                      <TealBtn onClick={confirmRemove} disabled={s.busy === 'remove' || removePin.length < 4} style={{ flex: 1 }}>{s.busy === 'remove' ? 'Removing…' : 'Remove account'}</TealBtn>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AddPayoutAccountModal
        show={adding}
        onClose={() => setAdding(false)}
        manager={manager}
        banks={banks}
        banksStatus={banksStatus}
        onRetryBanks={onRetryBanks}
        isMobile={isMobile}
      />
    </section>
  )
}
