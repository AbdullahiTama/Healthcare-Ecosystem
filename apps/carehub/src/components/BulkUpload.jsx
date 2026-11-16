import { Upload, AlertTriangle, CheckCircle, Copy, Download } from 'lucide-react'
import { theme } from '../styles/theme'
import { GhostBtn } from './ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray100, border, danger, dangerBg, warning, warningBg, success } = theme

// Presentation shared by the bulk uploads (Inventory, and the Purchases upload's Stat and Notice). The
// rules of each upload live in its service; these only show what it decided.
// Docs: docs/architecture/Bulk-Uploads-and-Debt-Linking.md

export function ImportStat({ label: text, value, tone }) {
  const color = tone === 'danger' ? danger : tone === 'success' ? success : tone === 'warning' ? warning : navy
  return (
    <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: tealMist }}>
      <div style={{ fontSize: 11, color: gray500, fontWeight: 600 }}>{text}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

export function ImportNotice({ tone, children }) {
  const c = tone === 'danger' ? { bg: dangerBg, fg: danger, Icon: AlertTriangle } : tone === 'warning' ? { bg: warningBg, fg: warning, Icon: AlertTriangle } : tone === 'success' ? { bg: tealMist, fg: tealDeep, Icon: CheckCircle } : { bg: tealMist, fg: tealDeep, Icon: Copy }
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: c.bg, border: `1px solid ${c.fg}`, fontSize: 12.5, color: navy, lineHeight: 1.5 }}>
      <c.Icon size={15} color={c.fg} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
      <div>{children}</div>
    </div>
  )
}

export function ImportStats({ stats }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8 }}>
      {stats.filter(Boolean).map(s => <ImportStat key={s.label} {...s} />)}
    </div>
  )
}

/** The file picker: an accessible label wrapping a visually hidden input. */
export function UploadDropzone({ accept = '.xlsx,.csv,.txt', title = 'Choose an .xlsx or .csv file', hint, disabled = false, onFile, ariaLabel = 'File to upload' }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 16px', borderRadius: theme.radius.lg, position: 'relative', border: `2px dashed ${border}`, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, textAlign: 'center' }}>
      <Upload size={28} color={tealDeep} aria-hidden='true' />
      <span style={{ fontWeight: 700, color: navy, fontSize: 14 }}>{title}</span>
      {hint && <span style={{ fontSize: 12, color: gray500 }}>{hint}</span>}
      <input type='file' accept={accept} disabled={disabled} aria-label={ariaLabel}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
    </label>
  )
}

export function UploadProgress({ done, total, noun = 'rows', note = 'Keep this page open until it finishes.' }) {
  return (
    <div role='status' aria-live='polite' style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 0' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: navy }}>Saving {Math.min(done, total).toLocaleString()} of {total.toLocaleString()} {noun}…</div>
      <div style={{ height: 8, borderRadius: 4, background: gray100, overflow: 'hidden' }} aria-hidden='true'>
        <div style={{ width: (total ? (done / total) * 100 : 0) + '%', height: '100%', background: tealDeep, transition: 'width 200ms' }} />
      </div>
      <div style={{ fontSize: 12, color: gray500 }}>{note}</div>
    </div>
  )
}

const STATUS_LOOK = {
  invalid: { label: 'Needs fixing', color: danger, bg: dangerBg },
  failed: { label: 'Not saved', color: danger, bg: dangerBg },
  over_limit: { label: 'Over plan limit', color: warning, bg: warningBg },
  duplicate: { label: 'Duplicate (skipped)', color: warning, bg: warningBg },
  warning: { label: 'Note', color: warning, bg: 'white' },
}
const SHOWN = 300

/** Rows that need attention: row number, what it is, and why. The first 300; the download has every one. */
export function RowIssueList({ entries, label = 'Rows that need attention' }) {
  if (!entries.length) return null
  return (
    <div>
      <ul aria-label={label} style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflowY: 'auto', border: `1px solid ${gray100}`, borderRadius: theme.radius.md }}>
        {entries.slice(0, SHOWN).map((e, i) => {
          const look = STATUS_LOOK[e.status] || STATUS_LOOK.warning
          return (
            <li key={e.rowNumber + ':' + i} style={{ padding: '8px 12px', borderBottom: `1px solid ${gray100}`, background: look.bg, fontSize: 12, lineHeight: 1.45 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: navy, minWidth: 0, overflowWrap: 'anywhere' }}>Row {e.rowNumber}{e.title ? ': ' + e.title : ''}</span>
                <span style={{ fontWeight: 700, color: look.color }}>{look.label}</span>
              </div>
              <div style={{ color: gray600 }}>{e.reason}</div>
            </li>
          )
        })}
      </ul>
      {entries.length > SHOWN && <div style={{ fontSize: 12, color: gray500, marginTop: 6 }}>And {(entries.length - SHOWN).toLocaleString()} more. Download the rows to see them all.</div>}
    </div>
  )
}

export function DownloadRowsButton({ count, onClick, children }) {
  if (!count) return null
  return (
    <GhostBtn onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <Download size={14} aria-hidden='true' /> {children || `Download ${count.toLocaleString()} row${count === 1 ? '' : 's'} to fix`}
    </GhostBtn>
  )
}
