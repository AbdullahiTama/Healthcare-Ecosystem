import { useId, useState } from 'react'
import { AlertTriangle, CheckCircle, Download, Upload, RotateCcw } from 'lucide-react'
import { Modal, GhostBtn, TealBtn, RedBtn } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { keptReasonText } from '../bulkEdit'

const { navy, gray500, gray600, border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme
export const DELETE_ALL_PHRASE = 'DELETE ALL PRODUCTS'

// Deleting products in bulk: the marked products (mode 'selected'), or every product to start again and re-upload
// (mode 'all', Owner only). The database does the work (delete_products): it keeps products tied to orders, batches,
// reviews, a shop listing or stock counts and says why, writes stock on hand off in the stock record, and keeps a
// copy of everything deleted so it can be restored.
//
// `onDelete()` performs the deletion and resolves to delete_products' result; `onBackup()` downloads an Excel copy
// (in the upload template's column order); `onRestore(deletionId)` undoes it; `onUpload()` opens the CSV upload.
export default function DeleteProductsModal({ mode, count, onDelete, onBackup, canBackup, onRestore, onUpload, onClose }) {
  const uid = useId()
  const all = mode === 'all'
  const [backedUp, setBackedUp] = useState(false)
  const [skipBackup, setSkipBackup] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [restored, setRestored] = useState(null)

  const ready = !all || (typed.trim() === DELETE_ALL_PHRASE && (backedUp || skipBackup || !canBackup))

  async function run() {
    if (!ready || busy) return
    setBusy(true); setError('')
    try {
      setResult(await onDelete())
    } catch (e) {
      setError(e?.message || 'Could not delete. Nothing was changed; please try again.')
    } finally { setBusy(false) }
  }
  async function undo() {
    setBusy(true); setError('')
    try {
      setRestored(await onRestore(result.deletion_id))
    } catch (e) {
      setError(e?.message || 'Could not restore. Please try again from Recently deleted.')
    } finally { setBusy(false) }
  }
  async function backup() {
    if (await onBackup()) setBackedUp(true)
  }

  const kept = result?.kept || []
  const title = all ? 'Delete all products and start again' : `Delete ${count} product${count === 1 ? '' : 's'}`

  if (result) {
    return (
      <Modal show onClose={() => { if (!busy) onClose() }} title={title}
        footer={<>
          {result.deleted > 0 && !restored && <GhostBtn onClick={undo} disabled={busy} style={{ flex: 1, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><RotateCcw size={14} aria-hidden='true' /> {busy ? 'Restoring…' : 'Undo'}</GhostBtn>}
          {all && !restored && result.deleted > 0 && onUpload && <TealBtn onClick={onUpload} style={{ flex: 1, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Upload size={14} aria-hidden='true' /> Upload your new list</TealBtn>}
          {(!all || restored || result.deleted === 0) && <TealBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Done</TealBtn>}
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {restored ? (
            <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: successBg, color: success, fontWeight: 700, fontSize: 13 }}>
              <CheckCircle size={16} aria-hidden='true' /> {restored.restored} product{restored.restored === 1 ? '' : 's'} restored.
              {restored.skipped_name_taken > 0 && <span style={{ fontWeight: 400 }}> {restored.skipped_name_taken} skipped because a product with the same name exists now.</span>}
            </div>
          ) : (
            <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: result.deleted ? successBg : bg, color: result.deleted ? success : gray600, fontWeight: 700, fontSize: 13 }}>
              <CheckCircle size={16} aria-hidden='true' /> {result.deleted} product{result.deleted === 1 ? '' : 's'} deleted.
              {result.deleted > 0 && <span style={{ fontWeight: 400 }}> You can undo this now, or later from Recently deleted.</span>}
            </div>
          )}
          {kept.length > 0 && (
            <div style={{ padding: 12, borderRadius: theme.radius.md, background: warningBg, fontSize: 12.5, color: navy }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 800, color: warning, marginBottom: 6 }}>
                <AlertTriangle size={14} aria-hidden='true' /> {kept.length} kept, because deleting them would remove or break other records
              </div>
              <ul aria-label='Products kept' style={{ margin: 0, paddingLeft: 18, maxHeight: 180, overflowY: 'auto' }}>
                {kept.map((k) => <li key={k.id}><strong>{k.name}</strong>: {keptReasonText(k.reasons)}</li>)}
              </ul>
              <div style={{ marginTop: 6, color: gray600 }}>To remove one, first deal with what it is linked to (for example remove its shop listing), or set its stock to 0 and leave it.</div>
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
        <RedBtn onClick={run} disabled={!ready || busy} aria-busy={busy || undefined} style={{ flex: 1, padding: 12 }}>
          {busy ? 'Deleting…' : all ? 'Delete all products' : `Delete ${count}`}
        </RedBtn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: navy }}>
        <div style={{ padding: 12, borderRadius: theme.radius.md, background: dangerBg, color: danger, display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} aria-hidden='true' style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {all ? `This deletes all ${count} products from this location, so you can upload your list again.` : `This deletes the ${count} marked product${count === 1 ? '' : 's'}.`}
            {' '}Their stock on hand is written off in your stock record.
          </span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: gray600, fontSize: 12.5, lineHeight: 1.6 }}>
          <li>Products in shop or internal orders, with stock batches, customer reviews, an online-shop listing or past stock counts are <strong>kept</strong>, and you will see which and why.</li>
          <li>Past sales and reports keep their figures. Held sales that include a deleted product can still be charged.</li>
          <li>You can <strong>restore</strong> deleted products afterwards from Recently deleted.</li>
        </ul>

        {all && (
          <>
            {canBackup && (
              <div style={{ padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>1. Download a copy first</div>
                <div style={{ fontSize: 12.5, color: gray600, marginBottom: 8 }}>The Excel file has the same columns as the upload template: correct it in Excel, save it as CSV, and upload it after deleting.</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <GhostBtn onClick={backup} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> {backedUp ? 'Downloaded' : 'Download Excel copy'}</GhostBtn>
                  {!backedUp && (
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: gray600 }}>
                      <input type='checkbox' checked={skipBackup} onChange={(e) => setSkipBackup(e.target.checked)} /> I already have a copy, or don't need one
                    </label>
                  )}
                </div>
              </div>
            )}
            <div>
              <label htmlFor={uid + '-confirm'} style={{ display: 'block', fontWeight: 800, marginBottom: 6 }}>{canBackup ? '2. ' : ''}Type <code style={{ background: bg, padding: '1px 5px', borderRadius: 4 }}>{DELETE_ALL_PHRASE}</code> to confirm</label>
              <input id={uid + '-confirm'} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete='off' spellCheck={false}
                style={{ width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </>
        )}
        {error && <div role='alert' style={{ color: danger, fontSize: 12.5 }}>{error}</div>}
      </div>
    </Modal>
  )
}
