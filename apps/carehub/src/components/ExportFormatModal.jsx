import { useState } from 'react'
import { Download } from 'lucide-react'
import { theme } from '../styles/theme'
import { Modal, GhostBtn, TealBtn } from './ui'

const { tealDeep, tealMist, navy, gray600, border } = theme

// Choosing an export's file format. `description` says what will be exported; `onExport(format)` does the work and
// resolves to true when the file was saved, so the dialog can show progress and close.
export default function ExportFormatModal({ show, onClose, title = 'Export', description, onExport, name = 'export-format' }) {
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
    <Modal show={show} onClose={busy ? () => {} : onClose} title={title} preventClose={busy}
      footer={<><GhostBtn onClick={onClose} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={run} disabled={busy} aria-busy={busy || undefined} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> {busy ? 'Exporting…' : 'Export'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {description && <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>{description}</div>}
        <div role='radiogroup' aria-label='File format' style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map(([value, label, note]) => (
            <label key={value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${format === value ? tealDeep : border}`, background: format === value ? tealMist : 'white', cursor: 'pointer' }}>
              <input type='radio' name={name} value={value} checked={format === value} onChange={() => setFormat(value)} style={{ marginTop: 3, accentColor: tealDeep }} />
              <span><span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: navy }}>{label}</span><span style={{ fontSize: 12, color: gray600 }}>{note}</span></span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}
