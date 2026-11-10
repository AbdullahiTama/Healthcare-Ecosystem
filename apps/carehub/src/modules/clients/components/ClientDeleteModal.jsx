import { useState } from 'react'
import { AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react'
import { Modal, GhostBtn, TealBtn, RedBtn } from '../../../components/ui'
import { theme } from '../../../styles/theme'

const { navy, gray500, gray600, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

export const CLIENT_KEPT_REASONS = {
  sales: 'has sales',
  appointments: 'has appointments',
  consultations: 'has consultations',
  debts: 'has debts',
  requests: 'has customer requests',
  linked_records: 'is linked to other client records',
}
export const clientKeptText = (reasons) => (reasons || []).map((r) => CLIENT_KEPT_REASONS[r] || r).join(', ')

// Deleting the marked clients. The database (delete_clients) keeps clients with history and says why, and keeps a
// copy of the rest so they can be restored. `onDelete()` resolves to its result; `onRestore(deletionId)` undoes it.
export default function ClientDeleteModal({ clients, onDelete, onRestore, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [restored, setRestored] = useState(null)
  const n = clients.length

  async function run() {
    setBusy(true); setError('')
    try { setResult(await onDelete()) } catch (e) { setError(e?.message || 'Could not delete. Nothing was changed; please try again.') } finally { setBusy(false) }
  }
  async function undo() {
    setBusy(true); setError('')
    try { setRestored(await onRestore(result.deletion_id)) } catch (e) { setError(e?.message || 'Could not restore. Try again from Recently deleted.') } finally { setBusy(false) }
  }

  const title = `Delete ${n} client${n === 1 ? '' : 's'}`
  if (result) {
    const kept = result.kept || []
    return (
      <Modal show onClose={() => { if (!busy) onClose() }} title={title}
        footer={<>
          {result.deleted > 0 && !restored && <GhostBtn onClick={undo} disabled={busy} style={{ flex: 1, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><RotateCcw size={14} aria-hidden='true' /> {busy ? 'Restoring…' : 'Undo'}</GhostBtn>}
          <TealBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Done</TealBtn>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: restored || result.deleted ? successBg : bg, color: restored || result.deleted ? success : gray600, fontWeight: 700, fontSize: 13 }}>
            <CheckCircle size={16} aria-hidden='true' />
            {restored
              ? <span>{restored.restored} client{restored.restored === 1 ? '' : 's'} restored.{restored.skipped_phone_taken > 0 && <span style={{ fontWeight: 400 }}> {restored.skipped_phone_taken} skipped because their phone number is used by another client now.</span>}</span>
              : <span>{result.deleted} client{result.deleted === 1 ? '' : 's'} deleted.{result.deleted > 0 && <span style={{ fontWeight: 400 }}> You can undo this now, or later from Recently deleted.</span>}</span>}
          </div>
          {kept.length > 0 && (
            <div style={{ padding: 12, borderRadius: theme.radius.md, background: warningBg, fontSize: 12.5, color: navy }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 800, color: warning, marginBottom: 6 }}>
                <AlertTriangle size={14} aria-hidden='true' /> {kept.length} kept, because their history must stay linked to them
              </div>
              <ul aria-label='Clients kept' style={{ margin: 0, paddingLeft: 18, maxHeight: 180, overflowY: 'auto' }}>
                {kept.map((k) => <li key={k.id}><strong>{k.name}</strong>: {clientKeptText(k.reasons)}</li>)}
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
        <RedBtn onClick={run} disabled={busy || n === 0} aria-busy={busy || undefined} style={{ flex: 1, padding: 12 }}>{busy ? 'Deleting…' : `Delete ${n}`}</RedBtn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: navy }}>
        <div style={{ padding: 12, borderRadius: theme.radius.md, background: dangerBg, color: danger, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} aria-hidden='true' style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This deletes the {n} marked client{n === 1 ? '' : 's'}.</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: gray600, fontSize: 12.5, lineHeight: 1.6 }}>
          <li>Clients with sales, appointments, consultations, debts or customer requests are <strong>kept</strong>, and you will see which and why.</li>
          <li>You can <strong>restore</strong> deleted clients afterwards from Recently deleted.</li>
        </ul>
        {n <= 5 && <div style={{ fontSize: 12.5, color: gray600 }}>{clients.map((c) => c.full_name).join(', ')}</div>}
        {error && <div role='alert' style={{ color: danger, fontSize: 12.5 }}>{error}</div>}
      </div>
    </Modal>
  )
}
