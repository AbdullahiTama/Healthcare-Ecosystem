import { useId, useMemo, useState } from 'react'
import BulkEditShell from '../../../components/BulkEditShell'
import { theme } from '../../../styles/theme'
import { fmt, todayDate } from '../../../lib/utils'
import { EMPTY_PURCHASE_BULK_EDIT, DUE_MODES, FIELD_NAMES, validatePurchaseBulkEdit, planPurchaseBulkEdit } from '../purchaseBulkEdit'

const { navy, gray500, gray600, border, danger, bg } = theme
const field = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, color: navy, background: 'white', boxSizing: 'border-box', fontFamily: 'inherit' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }
const show = (v) => (v ? `"${v}"` : 'not set')

// Changes the supplier, supply date, due date and notes of every marked purchase, each through Edit purchase on the
// server (so the debt, payment history and audit follow), with one reason for all. Lines, quantities, costs and the
// amount paid are never changed here. The shared BulkEditShell saves, shows progress and the result, and retries.
export default function PurchaseBulkEditModal({ purchases, suppliers = [], runUpdates, onClose }) {
  const uid = useId()
  const today = todayDate()
  const [changes, setChanges] = useState(EMPTY_PURCHASE_BULK_EDIT)
  const set = (k, v) => setChanges((c) => ({ ...c, [k]: v }))
  const check = validatePurchaseBulkEdit(changes, { today })
  const plan = useMemo(() => planPurchaseBulkEdit(purchases, changes, { today }), [purchases, changes, today])
  const total = purchases.reduce((n, p) => n + (Number(p.total_cost) || 0), 0)

  const err = (k) => check.errors[k] && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors[k]}</div>
  return (
    <BulkEditShell noun='purchase' count={purchases.length} plan={plan} valid={check.ok}
      runUpdates={(groups, onProgress) => runUpdates(groups, onProgress, changes.reason.trim())} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: gray600, padding: 10, borderRadius: theme.radius.md, background: bg }}>
          {purchases.length} marked, {fmt(total)} in all. Fill in only what you want to change. Items, quantities, costs and payments are not changed here: use Edit purchase or Record payment, so stock and money stay right.
        </div>
        <div>
          <label htmlFor={uid + '-sup'} style={label}>Supplier</label>
          <input id={uid + '-sup'} list={uid + '-sups'} value={changes.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.supplier} />
          <datalist id={uid + '-sups'}>{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          {err('supplier')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12 }}>
          <div>
            <label htmlFor={uid + '-supply'} style={label}>Supply date</label>
            <input id={uid + '-supply'} type='date' max={today} value={changes.supplyDate} onChange={(e) => set('supplyDate', e.target.value)} style={field} aria-invalid={!!check.errors.supplyDate} />
            {err('supplyDate')}
          </div>
          <div>
            <label htmlFor={uid + '-duemode'} style={label}>Due date</label>
            <select id={uid + '-duemode'} value={changes.dueMode} onChange={(e) => set('dueMode', e.target.value)} style={field}>
              <option value=''>Leave as it is</option>
              {DUE_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {changes.dueMode === 'set' && (
            <div>
              <label htmlFor={uid + '-due'} style={label}>New due date</label>
              <input id={uid + '-due'} type='date' value={changes.dueDate} onChange={(e) => set('dueDate', e.target.value)} style={field} aria-invalid={!!check.errors.dueDate} />
              {err('dueDate')}
            </div>
          )}
        </div>
        <div>
          <label htmlFor={uid + '-notes'} style={label}>Notes</label>
          <input id={uid + '-notes'} value={changes.notes} onChange={(e) => set('notes', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.notes} />
          {err('notes')}
        </div>
        {check.hasChanges && (
          <div>
            <label htmlFor={uid + '-reason'} style={label}>Reason for the change (required)</label>
            <input id={uid + '-reason'} value={changes.reason} onChange={(e) => set('reason', e.target.value)} placeholder='e.g. Supplier renamed' style={field} aria-invalid={!!check.errors.reason} aria-describedby={uid + '-reason-note'} />
            <div id={uid + '-reason-note'} style={{ fontSize: 12, color: gray500, marginTop: 4 }}>Kept in each purchase's edit history.</div>
            {err('reason')}
          </div>
        )}
        {check.hasChanges && check.ok && (
          <div role='status' aria-live='polite' style={{ padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, color: gray600 }}>
            {plan.length === 0 ? 'These purchases already have these values; nothing would change.' : (
              <>
                <strong style={{ color: navy }}>{plan.length} of {purchases.length} purchase{purchases.length === 1 ? '' : 's'} will change.</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {plan.slice(0, 4).map((item) => (
                    <li key={item.id}><strong style={{ color: navy }}>{item.label}</strong>: {Object.keys(item.updates).map((k) => `${FIELD_NAMES[k]} ${show(item.before[k])} → ${show(item.updates[k])}`).join('; ')}</li>
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
