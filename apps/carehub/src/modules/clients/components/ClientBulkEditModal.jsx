import { useId, useMemo, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { Modal, GhostBtn, TealBtn } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { todayDate } from '../../../lib/utils'
import { groupBulkUpdates } from '../../../lib/bulkUpdates'
import { CLIENT_GENDERS, EMPTY_CLIENT_BULK_EDIT, validateClientBulkEdit, planClientBulkEdit } from '../clientBulkEdit'

const { navy, gray500, gray600, border, danger, dangerBg, success, successBg, bg } = theme
const field = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, color: navy, background: 'white', boxSizing: 'border-box', fontFamily: 'inherit' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }

// Changes the same fields on every client the user marked: gender, address, and a dated note added to each client's
// notes. Empty fields stay as they are. `runUpdates(groups, onProgress)` saves and resolves to { saved, failed }.
export default function ClientBulkEditModal({ clients, runUpdates, onClose }) {
  const uid = useId()
  const [changes, setChanges] = useState(EMPTY_CLIENT_BULK_EDIT)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const set = (k, v) => setChanges((c) => ({ ...c, [k]: v }))
  const check = validateClientBulkEdit(changes)
  const today = todayDate()
  const plan = useMemo(() => planClientBulkEdit(clients, changes, { today }), [clients, changes, today])

  async function apply(groups) {
    setSaving(true); setProgress({ done: 0, total: groups.reduce((n, g) => n + g.ids.length, 0) })
    try {
      setResult(await runUpdates(groups, (done, total) => setProgress({ done, total })))
    } finally { setSaving(false) }
  }

  const failedCount = result ? result.failed.reduce((n, f) => n + f.ids.length, 0) : 0
  const footer = result ? (
    <>
      {failedCount > 0 && <GhostBtn onClick={() => apply(result.failed.map(({ ids, updates }) => ({ ids, updates })))} disabled={saving} style={{ flex: 1, padding: 12 }}>Try the failed ones again</GhostBtn>}
      <TealBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Done</TealBtn>
    </>
  ) : (
    <>
      <GhostBtn onClick={onClose} disabled={saving} style={{ flex: 1, padding: 12 }}>Cancel</GhostBtn>
      <TealBtn onClick={() => apply(groupBulkUpdates(plan))} disabled={saving || !check.ok || plan.length === 0} aria-busy={saving || undefined} style={{ flex: 1, padding: 12 }}>
        {saving ? `Saving ${progress?.done || 0} of ${progress?.total || plan.length}…` : `Update ${plan.length} client${plan.length === 1 ? '' : 's'}`}
      </TealBtn>
    </>
  )

  return (
    <Modal show onClose={() => { if (!saving) onClose() }} title={`Edit ${clients.length} client${clients.length === 1 ? '' : 's'}`} footer={footer}>
      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.saved.length > 0 && (
            <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: successBg, color: success, fontWeight: 700, fontSize: 13 }}>
              <CheckCircle size={16} aria-hidden='true' /> {result.saved.length} client{result.saved.length === 1 ? '' : 's'} updated.
            </div>
          )}
          {failedCount > 0 && (
            <div role='alert' style={{ padding: 12, borderRadius: theme.radius.md, background: dangerBg, color: danger, fontSize: 13 }}>
              <strong>{failedCount} could not be updated.</strong> {result.failed[0].message}
            </div>
          )}
        </div>
      ) : (
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
      )}
    </Modal>
  )
}
