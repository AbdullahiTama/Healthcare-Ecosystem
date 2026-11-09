import { useEffect, useId, useState } from 'react'
import { expenseRepository } from '../repositories'
import { PAYMENT_METHODS, EXPENSE_PAYMENT_CHOICES, expensePaid, expenseBalance, expensePaymentStatus, parseAmount } from '../expenseRules'
import { EXPENSE_PAYMENT_STATUSES } from '../expenseFilters'
import { fmt, todayDate } from '../../../lib/utils'
import { refusalMessage } from '../../../lib/dbErrors'
import { theme } from '../../../styles/theme'
import { Modal, Pill, Inp, GhostBtn, TealBtn, Loading } from '../../../components/ui'

// Payment status on expenses (carehub_20270107_expense_payments): how an expense stands when it is logged, paying
// off what is still owed, and the payment history. The rules are in expenseRules.js; money moves only through the
// database's record_expense_payment.

const { navy, gray400, gray500, gray600, border, tealDeep, tealMist, danger, success, bg } = theme

const STATUS_PILL = { paid: 'green', partial: 'blue', unpaid: 'amber' }
export function ExpenseStatusPill({ expense }) {
  const st = expensePaymentStatus(expense)
  return <Pill label={EXPENSE_PAYMENT_STATUSES.find(([k]) => k === st)[1]} type={STATUS_PILL[st]} />
}

function ChoiceGroup({ label, value, onChange, options }) {
  return (
    <div role='radiogroup' aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([v, l]) => (
        <button key={v} type='button' role='radio' aria-checked={value === v} onClick={() => onChange(v)}
          style={{ flex: '1 1 90px', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${value === v ? tealDeep : border}`, background: value === v ? tealMist : 'white', color: value === v ? tealDeep : gray600 }}>
          {l}
        </button>
      ))}
    </div>
  )
}

// The "Payment" part of the Log Expense form. Controlled by the page's form object (payment, amountPaid,
// paymentMethod); validation is validateExpense's.
export function ExpensePaymentFields({ form, setField, errors = {} }) {
  const payment = form.payment || 'paid'
  const amount = parseAmount(form.amount)
  const paidNow = payment === 'paid' ? amount : payment === 'partial' ? parseAmount(form.amountPaid) : 0
  const owed = Number.isFinite(amount) && Number.isFinite(paidNow) ? Math.max(amount - paidNow, 0) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: gray600 }}>Payment</div>
      <ChoiceGroup label='Payment' value={payment} onChange={(v) => setField('payment', v)} options={EXPENSE_PAYMENT_CHOICES} />
      {errors.payment && <div role='alert' style={{ fontSize: 12, color: danger }}>{errors.payment}</div>}
      {payment === 'partial' && (
        <Inp id='expense-amount-paid' label='Amount paid now (₦) *' value={form.amountPaid} onChange={(v) => setField('amountPaid', v)} type='number' min='0' placeholder='0' error={errors.amountPaid} />
      )}
      {payment !== 'unpaid' && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: gray600 }}>Paid by</div>
          <ChoiceGroup label='Paid by' value={form.paymentMethod || 'Cash'} onChange={(v) => setField('paymentMethod', v)} options={PAYMENT_METHODS.map((m) => [m, m])} />
        </>
      )}
      {payment !== 'paid' && owed !== null && owed > 0 && (
        <div style={{ padding: '8px 12px', borderRadius: theme.radius.md, background: bg, fontSize: 12.5, color: gray600 }}>
          Still to pay: <strong style={{ color: danger }}>{fmt(owed)}</strong>. Record the payment later from the expense list.
        </div>
      )}
    </div>
  )
}

// Paying some or all of what is still owed on an expense.
export function RecordExpensePaymentModal({ expense, staffName, onClose, onPaid, showToast }) {
  const owed = expenseBalance(expense)
  const [amount, setAmount] = useState(String(owed))
  const [method, setMethod] = useState('Cash')
  const [paidOn, setPaidOn] = useState(todayDate())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (saving) return
    const n = parseAmount(amount)
    if (!Number.isFinite(n) || n <= 0) { setError('Enter an amount greater than zero.'); return }
    if (n > owed) { setError('That is more than the ' + fmt(owed) + ' still owed.'); return }
    setSaving(true); setError('')
    try {
      await expenseRepository.recordPayment(expense.id, { amount: n, method, paidOn, note: note.trim(), staffName })
      console.info('[expenses] payment recorded', { id: expense.id, amount: n })
      showToast(fmt(n) + ' paid on this expense.' + (n >= owed ? ' It is now paid in full.' : ' ' + fmt(owed - n) + ' still to pay.'), { type: 'success' })
      onPaid()
    } catch (e) {
      console.error('[expenses] payment failed:', e?.message)
      setError(refusalMessage(e, 'Could not record the payment. Nothing was changed; please try again.'))
    } finally { setSaving(false) }
  }

  return (
    <Modal show onClose={() => { if (!saving) onClose() }} title='Record payment'
      footer={<><GhostBtn onClick={onClose} disabled={saving} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={saving} aria-busy={saving || undefined} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : 'Record payment'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: 12, borderRadius: theme.radius.md, background: bg, fontSize: 13, color: gray600 }}>
          {expense.category}{expense.description ? ': ' + expense.description : ''}. Amount {fmt(expense.amount)}, paid {fmt(expensePaid(expense))}, <strong style={{ color: danger }}>{fmt(owed)} still to pay</strong>.
        </div>
        <Inp id='expense-payment-amount' label='Amount paid (₦) *' value={amount} onChange={setAmount} type='number' min='0' error={error || undefined} />
        <div style={{ fontSize: 11.5, fontWeight: 700, color: gray600 }}>Paid by</div>
        <ChoiceGroup label='Paid by' value={method} onChange={setMethod} options={PAYMENT_METHODS.map((m) => [m, m])} />
        <Inp id='expense-payment-date' label='Date paid' value={paidOn} onChange={setPaidOn} type='date' max={todayDate()} />
        <Inp id='expense-payment-note' label='Note (optional)' value={note} onChange={setNote} placeholder='e.g. receipt number' />
      </div>
    </Modal>
  )
}

const KIND_LABEL = { payment: 'Payment', at_recording: 'Paid when logged', before_history: 'Recorded before payment history' }

// The expense's paid / owed figures and its payment history, inside the expense detail.
export function ExpensePaymentSummary({ businessId, expense, available }) {
  const uid = useId()
  const [state, setState] = useState({ status: 'idle', rows: [] })
  useEffect(() => {
    if (!available || !expense?.id) return undefined
    let live = true
    setState({ status: 'loading', rows: [] })
    expenseRepository.getPayments(businessId, expense.id)
      .then((rows) => { if (live) setState({ status: 'ready', rows: rows || [] }) })
      .catch((e) => { console.error('[expenses] payment history failed:', e?.message); if (live) setState({ status: 'error', rows: [] }) })
    return () => { live = false }
  }, [businessId, expense?.id, available])

  const owed = expenseBalance(expense)
  return (
    <section aria-labelledby={uid} style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <h3 id={uid} style={{ margin: 0, fontSize: 13, fontWeight: 800, color: navy }}>Payment</h3>
        <ExpenseStatusPill expense={expense} />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, marginBottom: 10 }}>
        <span style={{ color: gray600 }}>Paid <strong style={{ color: success }}>{fmt(expensePaid(expense))}</strong></span>
        <span style={{ color: gray600 }}>Still to pay <strong style={{ color: owed > 0 ? danger : gray500 }}>{fmt(owed)}</strong></span>
      </div>
      {!available ? null : state.status === 'loading' ? <Loading text='Loading payments…' /> : state.status === 'error' ? (
        <div role='alert' style={{ fontSize: 12.5, color: danger }}>The payment history could not be loaded. The amounts above are correct.</div>
      ) : state.rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: gray500 }}>No payments yet.</div>
      ) : (
        <ul aria-label='Payment history' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {state.rows.map((p) => (
            <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: theme.radius.md, background: bg, fontSize: 12.5 }}>
              <span style={{ color: gray600, minWidth: 0 }}>
                <strong style={{ color: navy }}>{fmt(p.amount)}</strong> · {p.method} · {p.paid_on}
                <span style={{ display: 'block', color: gray400, fontSize: 11.5 }}>{KIND_LABEL[p.kind] || 'Payment'}{p.staff_name ? ' · ' + p.staff_name : ''}{p.note ? ' · ' + p.note : ''}</span>
              </span>
              <span style={{ color: gray500, whiteSpace: 'nowrap', fontSize: 11.5 }}>Left {fmt(p.balance_after)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
