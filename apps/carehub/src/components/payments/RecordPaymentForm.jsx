import { useState } from 'react'
import { Inp, Sel, TealBtn, GhostBtn } from '../ui'
import { fmt, todayDate } from '../../lib/utils'
import { validatePaymentAmount } from '../../lib/paymentRules'
import { theme } from '../../styles/theme'

// One form for recording a full or partial payment against something that has
// a balance: a customer's credit sale (POS) or a purchase owed to a supplier
// (Purchases). The amount is checked against the balance before sending; the
// database checks it again and its refusal is shown under the field.
//
// onSubmit({ amount, method, paidOn, note }) must return a promise; a rejected
// promise's message is shown as the form error.
export default function RecordPaymentForm({
  idPrefix,
  balance,
  methods,
  defaultMethod,
  showDate = false,
  showNote = false,
  submitLabel = 'Record payment',
  compact = false,
  onSubmit,
  onCancel,
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState(defaultMethod || methods[0])
  const [paidOn, setPaidOn] = useState(todayDate())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e?.preventDefault?.()
    const check = validatePaymentAmount(amount, balance)
    if (check.error) { setError(check.error); return }
    if (!method) { setError('Choose how it was paid.'); return }
    setError('')
    setSaving(true)
    try {
      await onSubmit({ amount: check.amount, method, paidOn: showDate ? paidOn : null, note: showNote ? note.trim() || null : null })
      setAmount('')
      setNote('')
    } catch (err) {
      setError(err?.message || "We couldn't record the payment. Try again.")
    }
    setSaving(false)
  }

  const owed = Math.round((Number(balance) || 0) * 100) / 100
  return (
    <form onSubmit={submit} noValidate aria-label='Record a payment'
      style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(120px, 1fr))' : '1fr', gap: 10, alignItems: 'end' }}>
      <div>
        <Inp id={`${idPrefix}-amount`} label='Amount received (₦)' type='number' inputMode='decimal' min='0' step='0.01'
          value={amount} onChange={(v) => { setAmount(v); if (error) setError('') }} placeholder={String(owed)} error={error || undefined} />
        <button type='button' onClick={() => { setAmount(String(owed)); setError('') }}
          style={{ marginTop: 4, background: 'none', border: 'none', padding: 0, color: theme.tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', minHeight: 24 }}>
          Full balance ({fmt(owed)})
        </button>
      </div>
      <Sel id={`${idPrefix}-method`} label='Paid by' value={method} onChange={setMethod} options={methods} placeholder='Choose…' />
      {showDate && <Inp id={`${idPrefix}-date`} label='Date paid' type='date' value={paidOn} onChange={setPaidOn} max={todayDate()} />}
      {showNote && <Inp id={`${idPrefix}-note`} label='Note (optional)' value={note} onChange={setNote} placeholder='e.g. cheque number, reference' maxLength={300} />}
      <div style={{ display: 'flex', gap: 8 }}>
        {onCancel && <GhostBtn type='button' onClick={onCancel} disabled={saving}>Cancel</GhostBtn>}
        <TealBtn type='submit' disabled={saving} aria-busy={saving} style={{ flex: 1, minHeight: 40 }}>{saving ? 'Saving…' : submitLabel}</TealBtn>
      </div>
    </form>
  )
}
