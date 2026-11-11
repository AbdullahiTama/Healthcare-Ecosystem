import { useState } from 'react'
import { Download } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, border } = theme

// Choosing the export format (docs/architecture/Purchases-Import-Export.md).
// `scope` describes what will be exported (the list's filters); `onExport(format)`
// does the work and resolves when done, so the dialog can show progress.
export default function PurchaseExportModal({ show, onClose, scope, onExport }) {
  const [format, setFormat] = useState('xlsx')
  const [busy, setBusy] = useState(false)
  async function run() {
    if (busy) return
    setBusy(true)
    try {
      const saved = await onExport(format)
      if (saved) onClose()
    } finally { setBusy(false) }
  }
  const options = [['xlsx', 'Excel (.xlsx)', 'Opens in Excel or Google Sheets, with money columns formatted.'], ['csv', 'CSV (.csv)', 'Plain text, for any spreadsheet or accounting tool.']]
  return (
    <Modal show={show} onClose={busy ? () => {} : onClose} title='Export purchases' preventClose={busy}
      footer={<><GhostBtn onClick={onClose} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={run} disabled={busy} aria-busy={busy || undefined} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> {busy ? 'Exporting…' : 'Export'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>
          Exports {scope}, one row per item, in the same columns as the upload template (so a corrected file can be uploaded again). Includes costs, so the export is recorded in the audit log.
        </div>
        <div role='radiogroup' aria-label='File format' style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map(([value, title, note]) => (
            <label key={value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${format === value ? tealDeep : border}`, background: format === value ? tealMist : 'white', cursor: 'pointer' }}>
              <input type='radio' name='purchase-export-format' value={value} checked={format === value} onChange={() => setFormat(value)} style={{ marginTop: 3, accentColor: tealDeep }} />
              <span><span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: navy }}>{title}</span><span style={{ fontSize: 12, color: gray600 }}>{note}</span></span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}
