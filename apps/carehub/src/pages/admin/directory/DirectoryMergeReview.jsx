import { useState, useMemo } from 'react'
import { Button, Modal, Select } from '../../../components/ui'
import { proposeMerge, defaultSelections, buildMergeChanges, summarizeSelections } from '../../../modules/directory/directoryMerge'

// Field-by-field review of merging one imported row into an existing directory
// business. Nothing here saves anything: Confirm only records the reviewer's
// choice; the merge runs later with the rest of the import, and the database
// re-checks every rule.
//
// Safe by default: blank fields are filled; values that differ are kept unless the
// reviewer ticks "Replace"; a verified record cannot have values replaced at all
// (use the normal Edit for that). Name, verification and source are never merged.

const show = (f, v, categories) => {
  if (v === null || v === undefined || v === '') return 'empty'
  if (f.key === 'coordinates') return v.latitude + ', ' + v.longitude
  if (f.key === 'category_id' || f.key === 'subcategory_id') return (categories.find((c) => c.id === v) || {}).name || 'selected category'
  return String(v)
}

export default function DirectoryMergeReview({ planRow, targets, existingById, categories = [], initial, onConfirm, onCancel }) {
  const [targetId, setTargetId] = useState((initial && initial.targetId) || targets[0].id)
  const existing = existingById[targetId]
  const proposal = useMemo(() => proposeMerge(planRow.record, existing), [planRow, existing])
  const [selections, setSelections] = useState(() => (initial && initial.targetId === targetId ? initial.selections : defaultSelections(proposeMerge(planRow.record, existingById[targetId]))))

  const changeTarget = (id) => {
    setTargetId(id)
    setSelections(defaultSelections(proposeMerge(planRow.record, existingById[id])))
  }
  const toggle = (key, mode) => setSelections((s) => { const n = { ...s }; if (n[key]) delete n[key]; else n[key] = mode; return n })
  const changes = buildMergeChanges(proposal, selections)

  return (
    <Modal show onClose={onCancel} title={'Merge row ' + planRow.row + ' into an existing business'} wide
      footer={<>
        <Button variant="ghost" size="sm" onClick={onCancel} style={{ flex: 1 }}>Cancel</Button>
        <Button variant="primary" size="md" disabled={!changes} onClick={() => onConfirm({ targetId, targetName: existing.name, selections, changes, summary: summarizeSelections(proposal, selections) })} style={{ flex: 1 }}>Use this merge</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Imported: <strong>{planRow.record.name}</strong>. A merge fills in missing details on the existing record. It never changes the name, the verification status or where the record came from. It happens when you run the import, and is recorded in the record's history.
        </p>
        {targets.length > 1 && (
          <Select label="Merge into" value={targetId} onChange={(v) => v && changeTarget(v)} placeholder="Choose" options={targets.map((t) => ({ value: t.id, label: t.name + (t.verification_status === 'verified' ? ' (verified)' : '') }))} />
        )}
        {targets.length === 1 && <div>Existing record: <strong>{existing.name}</strong>{existing.verification_status === 'verified' ? ' (verified)' : ''}</div>}
        {proposal.locked && (
          <div role="note" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            This record is verified, so its existing values are locked. Blanks can be filled. To change a value, edit the record directly.
          </div>
        )}
        {proposal.fields.length === 0 ? <div>The imported row has nothing to add to this record.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left' }}><th scope="col">Field</th><th scope="col">Existing</th><th scope="col">Imported</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {proposal.fields.map((f) => (
                <tr key={f.key} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                  <th scope="row" style={{ fontWeight: 600, padding: '6px 4px' }}>{f.label}</th>
                  <td style={{ padding: '6px 4px', overflowWrap: 'anywhere' }}>{show(f, f.existing, categories)}</td>
                  <td style={{ padding: '6px 4px', overflowWrap: 'anywhere' }}>{show(f, f.incoming, categories)}</td>
                  <td style={{ padding: '6px 4px' }}>
                    {f.kind === 'same' && <span style={{ color: 'var(--muted)' }}>Already the same</span>}
                    {f.kind === 'fill' && (
                      <label><input type="checkbox" checked={!!selections[f.key]} onChange={() => toggle(f.key, 'fill')} /> Fill the blank</label>
                    )}
                    {f.kind === 'conflict' && (proposal.locked
                      ? <span style={{ color: 'var(--muted)' }}>Locked (verified). Existing value kept</span>
                      : <label><input type="checkbox" checked={selections[f.key] === 'overwrite'} onChange={() => toggle(f.key, 'overwrite')} /> Replace the existing value</label>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div aria-live="polite" style={{ color: 'var(--muted)' }}>{changes ? 'This merge will: ' + summarizeSelections(proposal, selections) + '.' : 'Select at least one change, or cancel and choose Skip or Keep existing.'}</div>
      </div>
    </Modal>
  )
}
