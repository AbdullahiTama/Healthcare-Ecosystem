import { useId, useMemo, useState } from 'react'
import BulkEditShell from '../../../components/BulkEditShell'
import { theme } from '../../../styles/theme'
import { fmt } from '../../../lib/utils'
import { EMPTY_DEBT_BULK_EDIT, DUE_MODES, validateDebtBulkEdit, planDebtBulkEdit, descriptionLockedCount } from '../debtBulkEdit'

const { navy, gray500, gray600, border, danger, bg } = theme
const field = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, color: navy, background: 'white', boxSizing: 'border-box', fontFamily: 'inherit' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }
const NAMES = { due_date: 'due date', description: 'description' }
const show = (v) => (v ? `"${v}"` : 'not set')

// Changes the due date (any marked debt) and the description (debts recorded by hand) together. Amounts, payments and
// status are never changed here. The shared BulkEditShell saves, shows progress and the result, and retries failures.
export default function DebtBulkEditModal({ debts, runUpdates, onClose }) {
  const uid = useId()
  const [changes, setChanges] = useState(EMPTY_DEBT_BULK_EDIT)
  const set = (k, v) => setChanges((c) => ({ ...c, [k]: v }))
  const check = validateDebtBulkEdit(changes)
  const plan = useMemo(() => planDebtBulkEdit(debts, changes), [debts, changes])
  const balance = debts.reduce((n, d) => n + Math.max(Number(d.balance) || 0, 0), 0)
  const locked = descriptionLockedCount(debts)

  const err = (k) => check.errors[k] && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors[k]}</div>
  return (
    <BulkEditShell noun='debt' count={debts.length} plan={plan} valid={check.ok} runUpdates={runUpdates} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: gray600, padding: 10, borderRadius: theme.radius.md, background: bg }}>
          {debts.length} marked, {fmt(balance)} outstanding. Fill in only what you want to change. Amounts, payments and status are not changed here: use Mark paid, so every payment is recorded.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <div>
            <label htmlFor={uid + '-due'} style={label}>Due date</label>
            <select id={uid + '-due'} value={changes.dueMode} onChange={(e) => set('dueMode', e.target.value)} style={field}>
              <option value=''>Leave as it is</option>
              {DUE_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {changes.dueMode === 'set' && (
            <div>
              <label htmlFor={uid + '-date'} style={label}>New due date</label>
              <input id={uid + '-date'} type='date' value={changes.dueDate} onChange={(e) => set('dueDate', e.target.value)} style={field} aria-invalid={!!check.errors.dueDate} />
              {err('dueDate')}
            </div>
          )}
        </div>
        <div>
          <label htmlFor={uid + '-desc'} style={label}>Description</label>
          <input id={uid + '-desc'} value={changes.description} onChange={(e) => set('description', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.description} aria-describedby={locked ? uid + '-desc-note' : undefined} />
          {locked > 0 && <div id={uid + '-desc-note'} style={{ fontSize: 12, color: gray500, marginTop: 4 }}>{locked} marked debt{locked === 1 ? ' comes' : 's come'} from a credit sale or a purchase and keep{locked === 1 ? 's' : ''} its description.</div>}
          {err('description')}
        </div>
        {check.hasChanges && check.ok && (
          <div role='status' aria-live='polite' style={{ padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, color: gray600 }}>
            {plan.length === 0 ? 'These debts already have these values; nothing would change.' : (
              <>
                <strong style={{ color: navy }}>{plan.length} of {debts.length} debt{debts.length === 1 ? '' : 's'} will change.</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {plan.slice(0, 4).map((item) => (
                    <li key={item.id}><strong style={{ color: navy }}>{item.label}</strong>: {Object.keys(item.updates).map((k) => `${NAMES[k]} ${show(item.before[k])} → ${show(item.updates[k])}`).join('; ')}</li>
                  ))}
                </ul>
                {plan.length > 4 && <div style={{ color: gray500, marginTop: 4 }}>and {plan.length - 4} more.</div>}
              </>
            )}
          </div>
        )}
      </div>
    </BulkEditShell>
  )
}
