import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { Modal, Textarea, TealBtn, GhostBtn } from '../../../components/ui'
import { createHealthRepository } from '../../../modules/health/repositories'
import { authClient } from '../../../lib/authClient'

// Admin exports carry personal and clinical data off the platform, so every one is declared first (H7 governance):
// the admin gives a reason, and the export is written to export_logs (platform-admin only, see
// modules/health/repositories) with the row count, the reason and a watermark naming who exported it and when.
// The file is produced only after that record is saved. If it cannot be saved, nothing is downloaded: an export
// nobody can account for is worse than a failed one. Export logs are visible under Health > Audit log.

const defaultRepository = createHealthRepository()

async function defaultGetActor() {
  try {
    const { data } = await authClient.auth.getUser()
    return { id: data?.user?.id || null, email: data?.user?.email || null }
  } catch {
    return { id: null, email: null }
  }
}

export const MIN_REASON = 3

export function exportWatermark(email, now = new Date()) {
  return `${email || 'platform admin'} · ${now.toISOString()}`
}

function ExportReasonDialog({ spec, onClose, repository, getActor }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => { if (busy) return; setReason(''); setError(''); onClose() }

  const confirm = async () => {
    const trimmed = reason.trim()
    if (trimmed.length < MIN_REASON) { setError('Say why you are exporting this (at least 3 characters).'); return }
    setBusy(true); setError('')
    try {
      const actor = await getActor()
      const watermark = exportWatermark(actor.email)
      await repository.logExport({ export_type: spec.exportType, row_count: spec.rowCount, reason: trimmed, watermark, actor_admin_id: actor.id })
      try {
        await spec.run({ reason: trimmed, watermark })
      } catch (e) {
        console.error('[admin-export] file could not be produced after logging', spec.exportType, e)
        setError(`The export was recorded but the file could not be produced: ${e?.message || 'unknown error'}`)
        setBusy(false)
        return
      }
      setBusy(false); setReason(''); onClose({ exported: true })
    } catch (e) {
      console.error('[admin-export] export log refused', spec.exportType, e)
      setError(`The export could not be recorded, so nothing was downloaded. ${e?.message || ''}`.trim())
      setBusy(false)
    }
  }

  return (
    <Modal show={!!spec} onClose={close} title={spec ? `Export ${spec.label}` : 'Export'} preventClose={busy} footer={
      <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
        <GhostBtn onClick={close} disabled={busy} style={{ flex: 1 }}>Cancel</GhostBtn>
        <TealBtn onClick={confirm} disabled={busy} style={{ flex: 1 }}><Download size={14} style={{ marginRight: 6 }} aria-hidden="true" />{busy ? 'Exporting…' : 'Record and export'}</TealBtn>
      </div>
    }>
      {spec && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div style={{ color: 'var(--fg)' }}>
            {spec.rowCount} {spec.rowCount === 1 ? 'record' : 'records'} as {spec.format || 'CSV'}.
          </div>
          {spec.note && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{spec.note}</div>}
          <Textarea id="admin-export-reason" label="Reason for export" required value={reason} onChange={setReason} rows={3}
            placeholder="e.g. Quarterly NAFDAC submission, board report, partner reconciliation"
            error={error || undefined}
            helperText="Saved with your name and the time in the export log." />
        </div>
      )}
    </Modal>
  )
}

// const { requestExport, exportDialog } = useAuditedExport()
// requestExport({ exportType: 'admin.businesses.csv', label: 'businesses', rowCount: rows.length, run: () => downloadCsv(...) })
// ...render {exportDialog} once in the panel.
export function useAuditedExport({ repository = defaultRepository, getActor = defaultGetActor, onExported } = {}) {
  const [spec, setSpec] = useState(null)
  const requestExport = useCallback((next) => setSpec(next), [])
  const onClose = useCallback((result) => {
    const done = spec
    setSpec(null)
    if (result?.exported && done) onExported?.(done)
  }, [spec, onExported])
  const exportDialog = <ExportReasonDialog spec={spec} onClose={onClose} repository={repository} getActor={getActor} />
  return { requestExport, exportDialog }
}
