import { useId, useMemo, useState } from 'react'
import BulkEditShell from '../../../components/BulkEditShell'
import { theme } from '../../../styles/theme'
import { fmt, todayDate } from '../../../lib/utils'
import { EMPTY_EXPENSE_BULK_EDIT, validateExpenseBulkEdit, planExpenseBulkEdit } from '../expenseBulkEdit'

const { navy, gray500, gray600, border, danger, bg } = theme
const field = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, color: navy, background: 'white', boxSizing: 'border-box', fontFamily: 'inherit' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }
const NAMES = { category: 'category', date: 'date', staff_name: 'staff' }

// Changes the same fields on every expense the user marked: category, date, and the staff name typed on the form.
// Empty fields stay as they are. The shared BulkEditShell saves, shows progress and the result, and retries failures.
export default function ExpenseBulkEditModal({ expenses, categories, runUpdates, onClose }) {
  const uid = useId()
  const today = todayDate()
  const [changes, setChanges] = useState(EMPTY_EXPENSE_BULK_EDIT)
  const set = (k, v) => setChanges((c) => ({ ...c, [k]: v }))
  const check = validateExpenseBulkEdit(changes, { categories, today })
  const plan = useMemo(() => planExpenseBulkEdit(expenses, changes, { categories, today }), [expenses, changes, categories, today])
  const total = expenses.reduce((n, e) => n + (Number(e.amount) || 0), 0)

  const err = (k) => check.errors[k] && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors[k]}</div>
  return (
    <BulkEditShell noun='expense' count={expenses.length} plan={plan} valid={check.ok} runUpdates={runUpdates} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: gray600, padding: 10, borderRadius: theme.radius.md, background: bg }}>
          {expenses.length} marked, {fmt(total)} in all. Fill in only what you want to change. Amounts and payments are not changed here: use Record payment, so every payment is recorded.
        </div>
        <div>
          <label htmlFor={uid + '-cat'} style={label}>Category</label>
          <select id={uid + '-cat'} value={changes.category} onChange={(e) => set('category', e.target.value)} style={field} aria-invalid={!!check.errors.category}>
            <option value=''>Leave as it is</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {err('category')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <div>
            <label htmlFor={uid + '-date'} style={label}>Date</label>
            <input id={uid + '-date'} type='date' max={today} value={changes.date} onChange={(e) => set('date', e.target.value)} style={field} aria-invalid={!!check.errors.date} />
            {err('date')}
          </div>
          <div>
            <label htmlFor={uid + '-staff'} style={label}>Staff (as entered)</label>
            <input id={uid + '-staff'} value={changes.staffName} onChange={(e) => set('staffName', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.staffName} />
            {err('staffName')}
          </div>
        </div>
        {check.hasChanges && check.ok && (
          <div role='status' aria-live='polite' style={{ padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, color: gray600 }}>
            {plan.length === 0 ? 'These expenses already have these values; nothing would change.' : (
              <>
                <strong style={{ color: navy }}>{plan.length} of {expenses.length} expense{expenses.length === 1 ? '' : 's'} will change.</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {plan.slice(0, 4).map((item) => (
                    <li key={item.id}><strong style={{ color: navy }}>{item.label}</strong>: {Object.keys(item.updates).map((k) => `${NAMES[k]} ${item.before[k] || 'not set'} → ${item.updates[k]}`).join('; ')}</li>
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
