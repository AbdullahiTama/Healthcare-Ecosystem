import { useState } from 'react'
import { History, AlertTriangle } from 'lucide-react'
import { validateNewBudget, spentSince } from '../expenseRules'
import { fmt } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn, Inp } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray100, border, danger, success, warning, bg } = theme

const dayLabel = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')
const dayBefore = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }

// "Set new budget" (docs/architecture/Expense-Budgets.md). The budget in force
// is closed the day before the new one starts and kept in the budget history
// with what was spent against it; the new amount counts spending from its start.
// `onSave(value)` resolves once stored and throws otherwise (the dialog stays open).
export function NewBudgetModal({ month, current, range, expenses, spendingKnown, onSave, onClose }) {
  const [form, setForm] = useState({ amount: '', startsOn: range.defaultDay })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const startsOn = form.startsOn && form.startsOn >= range.min && form.startsOn <= range.max ? form.startsOn : null
  // What the current budget closes with, and what is already dated on or after the new start.
  const alreadyOnNew = startsOn ? spentSince(expenses, month, startsOn) : null
  const closingSpent = startsOn ? spentSince(expenses, month, current.startsOn) - alreadyOnNew : null
  const amount = Number(String(form.amount).replace(/[,\s]/g, ''))

  async function save() {
    if (saving) return
    const check = validateNewBudget(form, range)
    setErrors(check.errors)
    if (!check.ok) return
    setSaving(true); setFailure('')
    try {
      await onSave(check.value)
      onClose()
    } catch (e) {
      console.error('[expenses] new budget save failed:', e?.message)
      setFailure(e?.code === 'NEW_BUDGET_UNAVAILABLE' || /Only the Owner|must start|no budget for/.test(e?.message || '')
        ? String(e.message).replace(/^Supabase error \(\d{3}\):\s*/, '')
        : 'Could not set the new budget. Nothing was changed; please try again.')
    }
    setSaving(false)
  }

  return (
    <Modal show onClose={saving ? () => {} : onClose} title={'Set new budget: ' + month} preventClose={saving}
      footer={<><GhostBtn onClick={onClose} disabled={saving} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} disabled={saving} aria-busy={saving || undefined} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : 'Start new budget'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 14, borderRadius: theme.radius.md, background: tealMist, fontSize: 13, color: tealDeep, lineHeight: 1.7 }}>
          The current budget of <strong>{fmt(current.amount)}</strong> (from {dayLabel(current.startsOn)}) ends the day before the new one starts and is <strong>kept in the budget history</strong> with what was spent against it.
          The new budget counts spending from its start date and carries over to the following months until you change it. Use <strong>Edit budget</strong> instead to correct the current amount.
        </div>
        <Inp id='expense-new-budget-amount' label={'New budget (₦)'} value={form.amount} onChange={v => set('amount', v)} type='number' min='0' placeholder='e.g. 30000' error={errors.amount} />
        <Inp id='expense-new-budget-start' label='Starts on' value={form.startsOn} onChange={v => set('startsOn', v)} type='date' min={range.min} max={range.max} error={errors.startsOn} />
        {startsOn && (
          <div style={{ padding: '12px 16px', borderRadius: theme.radius.md, background: bg, border: `1px solid ${border}`, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Row label={'Current budget closes on ' + dayLabel(dayBefore(startsOn))} value={spendingKnown ? fmt(closingSpent) + ' spent of ' + fmt(current.amount) : '—'} color={spendingKnown && closingSpent > current.amount ? danger : navy} />
            <Row label={'Already spent from ' + dayLabel(startsOn)} value={spendingKnown ? fmt(alreadyOnNew) : '—'} color={danger} />
            {amount > 0 && <Row label='New budget remaining' value={spendingKnown ? fmt(amount - alreadyOnNew) : '—'} color={spendingKnown && amount - alreadyOnNew < 0 ? danger : success} strong />}
          </div>
        )}
        {failure && (
          <div role='alert' style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${danger}`, fontSize: 12.5, color: danger }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' /> {failure}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, value, color, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, ...(strong ? { borderTop: `1px solid ${border}`, paddingTop: 6 } : {}) }}>
      <span style={{ color: gray500 }}>{label}</span>
      <span style={{ fontWeight: strong ? 900 : 700, color, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

// The month's earlier budgets: replaced by a new budget (with the days they ran and what was spent) or edited.
// Nothing is shown when there are none; a failed read says so with a retry.
export function BudgetHistory({ status, history = [], month, onRetry }) {
  if (status === 'error') {
    return (
      <div role='alert' style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: navy }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} color={warning} aria-hidden='true' /> Earlier budgets for {month} could not be loaded.</span>
        <button type='button' onClick={onRetry} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', fontSize: 12.5 }}>Try again</button>
      </div>
    )
  }
  if (!history.length) return null
  return (
    <details style={{ marginTop: 12, borderTop: `1px solid ${gray100}`, paddingTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: gray600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <History size={14} aria-hidden='true' /> Earlier budgets in {month} ({history.length})
      </summary>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map(h => (
          <li key={h.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: theme.radius.md, background: bg, fontSize: 12.5 }}>
            <span style={{ color: navy }}>
              <strong>{fmt(h.amount)}</strong>{' '}
              {h.reason === 'replaced'
                ? <>from {dayLabel(h.startsOn)} to {dayLabel(h.endedOn)}, replaced by {fmt(h.newAmount)}</>
                : <>from {dayLabel(h.startsOn)}, changed to {fmt(h.newAmount)}</>}
            </span>
            {h.reason === 'replaced' && h.spent != null && (
              <span style={{ fontWeight: 700, color: h.spent > h.amount ? danger : gray600 }}>
                {fmt(h.spent)} spent{h.spent > h.amount ? ' (over by ' + fmt(h.spent - h.amount) + ')' : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
