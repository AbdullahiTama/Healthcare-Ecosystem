import { useState } from 'react'
import { AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react'
import { Modal, GhostBtn, TealBtn, RedBtn } from './ui'
import { theme } from '../styles/theme'

const { navy, gray500, gray600, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

// Deleting the marked records through a checked database function (delete_clients, delete_expenses): a confirmation,
// then the result with anything kept and why, and Undo. `onDelete()` resolves to { deletion_id, deleted, kept,
// not_found }; `onRestore(deletionId)` resolves to the restore result, worded by `describeRestore`. `notes` are the
// points shown before deleting; `reasonText(reasons, kept)` words why a record was kept; `names` lists a few marked records.
export default function BulkDeleteModal({ noun, count, names = [], notes = [], reasonText = (r) => r.join(', '), keptHeading,
  describeRestore = () => '', onDelete, onRestore, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [restored, setRestored] = useState(null)
  const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`

  async function run() {
    setBusy(true); setError('')
    try { setResult(await onDelete()) } catch (e) { setError(e?.message || 'Could not delete. Nothing was changed; please try again.') } finally { setBusy(false) }
  }
  async function undo() {
    setBusy(true); setError('')
    try { setRestored(await onRestore(result.deletion_id)) } catch (e) { setError(e?.message || 'Could not restore. Try again from Recently deleted.') } finally { setBusy(false) }
  }

  const title = `Delete ${plural(count)}`
  if (result) {
    const kept = result.kept || []
    const ok = restored || result.deleted
    return (
      <Modal show onClose={() => { if (!busy) onClose() }} title={title}
        footer={<>
          {result.deleted > 0 && !restored && <GhostBtn onClick={undo} disabled={busy} style={{ flex: 1, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><RotateCcw size={14} aria-hidden='true' /> {busy ? 'Restoring…' : 'Undo'}</GhostBtn>}
          <TealBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Done</TealBtn>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: ok ? successBg : bg, color: ok ? success : gray600, fontWeight: 700, fontSize: 13 }}>
            <CheckCircle size={16} aria-hidden='true' />
            {restored
              ? <span>{plural(restored.restored)} restored.{describeRestore(restored) && <span style={{ fontWeight: 400 }}> {describeRestore(restored)}</span>}</span>
              : <span>{plural(result.deleted)} deleted.{result.deleted > 0 && <span style={{ fontWeight: 400 }}> You can undo this now, or later from Recently deleted.</span>}</span>}
          </div>
          {kept.length > 0 && (
            <div style={{ padding: 12, borderRadius: theme.radius.md, background: warningBg, fontSize: 12.5, color: navy }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 800, color: warning, marginBottom: 6 }}>
                <AlertTriangle size={14} aria-hidden='true' /> {kept.length} kept{keptHeading ? ', ' + keptHeading : ''}
              </div>
              <ul aria-label={`${noun}s kept`} style={{ margin: 0, paddingLeft: 18, maxHeight: 180, overflowY: 'auto' }}>
                {kept.map((k) => <li key={k.id}><strong>{k.name}</strong>: {reasonText(k.reasons, k)}</li>)}
              </ul>
            </div>
          )}
          {result.not_found > 0 && <div style={{ fontSize: 12.5, color: gray500 }}>{result.not_found} were already gone.</div>}
          {error && <div role='alert' style={{ color: danger, fontSize: 12.5 }}>{error}</div>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal show onClose={() => { if (!busy) onClose() }} title={title}
      footer={<>
        <GhostBtn onClick={onClose} disabled={busy} style={{ flex: 1, padding: 12 }}>Cancel</GhostBtn>
        <RedBtn onClick={run} disabled={busy || count === 0} aria-busy={busy || undefined} style={{ flex: 1, padding: 12 }}>{busy ? 'Deleting…' : `Delete ${count}`}</RedBtn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: navy }}>
        <div style={{ padding: 12, borderRadius: theme.radius.md, background: dangerBg, color: danger, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} aria-hidden='true' style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This deletes the {count} marked {noun}{count === 1 ? '' : 's'}.</span>
        </div>
        {notes.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, color: gray600, fontSize: 12.5, lineHeight: 1.6 }}>
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        {count <= 5 && names.length > 0 && <div style={{ fontSize: 12.5, color: gray600 }}>{names.join(', ')}</div>}
        {error && <div role='alert' style={{ color: danger, fontSize: 12.5 }}>{error}</div>}
      </div>
    </Modal>
  )
}
