import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { Modal, GhostBtn, TealBtn } from './ui'
import { theme } from '../styles/theme'
import { groupBulkUpdates } from '../lib/bulkUpdates'

const { danger, dangerBg, success, successBg, warningBg } = theme

// The frame every bulk-edit dialog shares (Inventory, Clients, Expenses): the Update button with progress, the saved /
// failed result, and "Try the failed ones again". The page supplies the fields (children) and the plan
// ([{ id, updates }], only records that would change); `runUpdates(groups, onProgress)` saves and resolves to
// { saved, failed } (lib/bulkUpdates.js), optionally with `notes` (sentences shown under the result, e.g. records
// skipped and why). `noun` is singular ('product').
export default function BulkEditShell({ noun, count, plan, valid, runUpdates, onClose, children }) {
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`

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
      <TealBtn onClick={() => apply(groupBulkUpdates(plan))} disabled={saving || !valid || plan.length === 0} aria-busy={saving || undefined} style={{ flex: 1, padding: 12 }}>
        {saving ? `Saving ${progress?.done || 0} of ${progress?.total || plan.length}…` : `Update ${plural(plan.length)}`}
      </TealBtn>
    </>
  )

  return (
    <Modal show onClose={() => { if (!saving) onClose() }} title={`Edit ${plural(count)}`} footer={footer}>
      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.saved.length > 0 && (
            <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: successBg, color: success, fontWeight: 700, fontSize: 13 }}>
              <CheckCircle size={16} aria-hidden='true' /> {plural(result.saved.length)} updated.
            </div>
          )}
          {failedCount > 0 && (
            <div role='alert' style={{ padding: 12, borderRadius: theme.radius.md, background: dangerBg, color: danger, fontSize: 13 }}>
              <strong>{failedCount} could not be updated.</strong> {result.failed[0].message}
            </div>
          )}
          {(result.notes || []).map((n) => (
            <div key={n} style={{ padding: 12, borderRadius: theme.radius.md, background: warningBg, color: theme.amberText, fontSize: 13 }}>{n}</div>
          ))}
        </div>
      ) : children}
    </Modal>
  )
}
