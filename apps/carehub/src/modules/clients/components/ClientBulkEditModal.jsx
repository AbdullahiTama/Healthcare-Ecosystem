import { useId, useMemo, useState } from 'react'
import BulkEditShell from '../../../components/BulkEditShell'
import { theme } from '../../../styles/theme'
import { todayDate } from '../../../lib/utils'
import { CLIENT_GENDERS, EMPTY_CLIENT_BULK_EDIT, validateClientBulkEdit, planClientBulkEdit } from '../clientBulkEdit'

const { navy, gray500, gray600, border, danger, bg } = theme
const field = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, color: navy, background: 'white', boxSizing: 'border-box', fontFamily: 'inherit' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }

// Changes the same fields on every client the user marked: gender, address, and a dated note added to each client's
// notes. Empty fields stay as they are. `runUpdates(groups, onProgress)` saves and resolves to { saved, failed }.
export default function ClientBulkEditModal({ clients, runUpdates, onClose }) {
  const uid = useId()
  const [changes, setChanges] = useState(EMPTY_CLIENT_BULK_EDIT)
  const set = (k, v) => setChanges((c) => ({ ...c, [k]: v }))
  const check = validateClientBulkEdit(changes)
  const today = todayDate()
  const plan = useMemo(() => planClientBulkEdit(clients, changes, { today }), [clients, changes, today])

  return (
    <BulkEditShell noun='client' count={clients.length} plan={plan} valid={check.ok} runUpdates={runUpdates} onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12.5, color: gray600, padding: 10, borderRadius: theme.radius.md, background: bg }}>
            Fill in only what you want to change; empty fields stay as they are. Names, phone numbers and emails are each client's own and are not changed here. Visits and total spent come from sales.
          </div>
          <div>
            <label htmlFor={uid + '-gender'} style={label}>Gender</label>
            <select id={uid + '-gender'} value={changes.gender} onChange={(e) => set('gender', e.target.value)} style={field}>
              <option value=''>Leave as it is</option>
              {CLIENT_GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={uid + '-address'} style={label}>Address</label>
            <input id={uid + '-address'} value={changes.address} onChange={(e) => set('address', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.address} />
            {check.errors.address && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors.address}</div>}
          </div>
          <div>
            <label htmlFor={uid + '-note'} style={label}>Add a note</label>
            <textarea id={uid + '-note'} rows={2} value={changes.note} onChange={(e) => set('note', e.target.value)} placeholder='Added to the end of each client’s notes, with today’s date'
              style={{ ...field, minHeight: 64, resize: 'vertical' }} aria-invalid={!!check.errors.note} aria-describedby={uid + '-note-help'} />
            <div id={uid + '-note-help'} style={{ fontSize: 11.5, color: gray500, marginTop: 4 }}>Existing notes are kept.</div>
            {check.errors.note && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors.note}</div>}
          </div>
          {check.hasChanges && check.ok && (
            <div role='status' aria-live='polite' style={{ padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, color: gray600 }}>
              {plan.length === 0 ? 'These clients already have these values; nothing would change.' : (
                <>
                  <strong style={{ color: navy }}>{plan.length} of {clients.length} client{clients.length === 1 ? '' : 's'} will change.</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    {plan.slice(0, 4).map((item) => (
                      <li key={item.id}><strong style={{ color: navy }}>{item.name}</strong>: {[
                        item.updates.gender && `gender ${item.before.gender || 'not set'} → ${item.updates.gender}`,
                        item.updates.address && `address → ${item.updates.address}`,
                        item.updates.notes && 'note added',
                      ].filter(Boolean).join('; ')}</li>
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
