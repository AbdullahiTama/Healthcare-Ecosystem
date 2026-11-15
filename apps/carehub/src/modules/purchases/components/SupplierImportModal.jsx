import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, Download, FileSpreadsheet } from 'lucide-react'
import { readSpreadsheet } from '../../business-directory/services/importService'
import { downloadBlob } from '../../business-directory/services/exportService'
import { purchaseRepository } from '../repositories'
import {
  SUPPLIER_FIELDS, SUPPLIER_SHEET, MAX_SUPPLIER_IMPORT_BYTES, MAX_SUPPLIER_IMPORT_ROWS, IMPORT_STATUS,
  readSupplierTable, prepareSupplierImport, buildSupplierTemplateCsv, buildSupplierTemplateXlsx,
} from '../supplierDirectory'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading, Pill } from '../../../components/ui'
import { Notice, Stat } from '../../debts/components/DebtImportModal'

const { tealDeep, navy, gray600, gray500, border, danger, dangerBg, warning } = theme

const VIEWS = [['all', 'All rows'], ['attention', 'Needs attention'], ['ready', 'Ready']]

// Excel / CSV import of the supplier list (contact details). Steps: choose a file → preview (every row checked against
// the format rules, the rest of the file and the suppliers the business already has; nothing saved yet) → import →
// result. Balances owed to suppliers are a separate import (Opening balances). Docs: docs/architecture/Supplier-Directory.md.
export default function SupplierImportModal({ brand, directory, accounts, onClose, onDone, repo = purchaseRepository }) {
  const [step, setStep] = useState('choose') // choose | reading | preview | importing | done
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState(null) // { rows, missing, ignored }
  const [fillExisting, setFillExisting] = useState(false)
  const [view, setView] = useState('all')
  const [result, setResult] = useState(null)
  const queryClient = useQueryClient()
  const busy = step === 'reading' || step === 'importing'

  const preview = useMemo(() => (table && !table.missing.length ? prepareSupplierImport(table.rows, { directory, accounts, fillExisting }) : null),
    [table, directory, accounts, fillExisting])
  const s = preview?.summary || {}
  const toSave = (s.new || 0) + (s.fill || 0)
  const shown = (preview?.items || []).filter((i) => view === 'all'
    || (view === 'ready' ? (i.status === 'new' || i.status === 'fill') : (i.status === 'error' || i.status === 'duplicate' || i.warnings.length)))
  const canFill = (preview?.items || []).some((i) => i.status === 'fill' || i.fillable)

  function reset() { setStep('choose'); setError(''); setFileName(''); setTable(null); setFillExisting(false); setView('all'); setResult(null) }
  function close() { if (!busy) onClose() }

  async function downloadTemplate(format) {
    try {
      if (format === 'csv') downloadBlob(buildSupplierTemplateCsv(), 'CareHub_Suppliers_Template.csv', 'text/csv;charset=utf-8')
      else downloadBlob(await buildSupplierTemplateXlsx(), 'CareHub_Suppliers_Template.xlsx')
    } catch (e) {
      console.error('[suppliers] template download failed:', e)
      setError('Could not create the template. Please try again.')
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setFileName(file.name); setStep('reading')
    try {
      const raw = await readSpreadsheet(file, { sheetName: SUPPLIER_SHEET, columnCount: SUPPLIER_FIELDS.length, maxBytes: MAX_SUPPLIER_IMPORT_BYTES })
      const t = readSupplierTable(raw)
      setTable(t)
      setStep('preview')
      console.info('[suppliers] import file read', { rows: t.rows.length, missing: t.missing })
    } catch (err) {
      console.error('[suppliers] import: could not read the file:', err?.message)
      setError(err?.message || 'Could not read the file. Use the CareHub template.')
      setStep('choose')
    }
  }

  async function commit() {
    if (!toSave || busy) return
    setStep('importing')
    const fresh = preview.items.filter((i) => i.status === 'new').map((i) => i.record)
    const fills = preview.items.filter((i) => i.status === 'fill')
    try {
      const created = fresh.length ? await repo.createSuppliers(brand.id, fresh) : { added: [], skipped: 0, failed: [] }
      let filled = 0
      const fillFailed = []
      for (const i of fills) {
        try { await repo.updateSupplier(brand.id, i.fill.id, i.fill.changes); filled++ } catch (err) { fillFailed.push({ names: [i.name], message: err?.message || 'Could not save' }) }
      }
      const failed = [...created.failed, ...fillFailed]
      const r = { added: created.added.length, skipped: created.skipped, filled, failed, attention: s.errors + s.duplicate }
      console.info('[suppliers] imported', { added: r.added, filled, skipped: r.skipped, failed: failed.length })
      if (failed.length) console.error('[suppliers] import: some suppliers were not saved', failed.map((f) => f.message))
      setResult(r)
      setStep('done')
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      onDone?.(r)
    } catch (err) {
      console.error('[suppliers] import failed:', err)
      setError((err?.message || 'The import failed.') + ' Try again: suppliers already saved are skipped, never duplicated.')
      setStep('preview')
    }
  }

  const footer = step === 'preview' && preview ? (
    <>
      <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
      <TealBtn onClick={commit} disabled={!toSave} style={{ flex: 1, padding: '12px' }}>{toSave ? `Import ${toSave} supplier${toSave === 1 ? '' : 's'}` : 'Nothing to import'}</TealBtn>
    </>
  ) : step === 'preview' ? <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
    : step === 'done' ? <TealBtn onClick={close} style={{ flex: 1, padding: '12px' }}>Done</TealBtn>
      : <GhostBtn onClick={close} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>

  return (
    <Modal show onClose={close} title='Import supplier list from Excel / CSV' wide preventClose={busy} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {step === 'choose' && (
          <>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>
              One row per supplier with their contact details. Suppliers you already have (by name, ignoring capitals and spacing)
              are not added twice. You will see every row, and what needs attention, before anything is saved. Up to {MAX_SUPPLIER_IMPORT_ROWS.toLocaleString()} rows per file.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <GhostBtn onClick={() => downloadTemplate('xlsx')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Excel template</GhostBtn>
              <GhostBtn onClick={() => downloadTemplate('csv')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> CSV template</GhostBtn>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 16px', borderRadius: theme.radius.lg, position: 'relative', border: `2px dashed ${border}`, cursor: 'pointer', textAlign: 'center' }}>
              <Upload size={28} color={tealDeep} aria-hidden='true' />
              <span style={{ fontWeight: 700, color: navy, fontSize: 14 }}>Choose an .xlsx or .csv file</span>
              <span style={{ fontSize: 12, color: gray500 }}>Required: Supplier Name. Phone or email makes a complete record.</span>
              <input type='file' accept='.xlsx,.csv,.txt' onChange={onFile} aria-label='Supplier list file to import' style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
            </label>
            {error && <Notice tone='danger'>{error}</Notice>}
          </>
        )}

        {step === 'reading' && <Loading text={'Checking ' + fileName + '…'} />}
        {step === 'importing' && <Loading text='Importing… keep this page open.' />}

        {step === 'preview' && table?.missing.length > 0 && (
          <Notice tone='danger'>{fileName} is missing <strong>{table.missing.join(', ')}</strong>. Use the CareHub template, or rename your headers to match it.</Notice>
        )}

        {step === 'preview' && preview && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: navy, fontWeight: 700 }}>
              <FileSpreadsheet size={16} color={tealDeep} aria-hidden='true' /> {fileName}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
              <Stat label='New suppliers' value={s.new} tone='success' />
              {fillExisting && <Stat label='Details added' value={s.fill} tone='success' />}
              <Stat label='Already in list' value={s.exists} />
              <Stat label='Repeated in file' value={s.duplicate} tone={s.duplicate ? 'danger' : undefined} />
              <Stat label='Need fixing' value={s.errors} tone={s.errors ? 'danger' : undefined} />
            </div>
            {table.ignored.length > 0 && <div style={{ fontSize: 12, color: gray500 }}>Columns not used: {table.ignored.join(', ')}.</div>}
            {error && <Notice tone='danger'>{error}</Notice>}
            {s.errors > 0 && <Notice tone='danger'>{s.errors} row{s.errors === 1 ? '' : 's'} will not be imported until fixed. The others can be imported now; fix the file and upload just those rows later.</Notice>}
            {(canFill || fillExisting) && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: navy, cursor: 'pointer' }}>
                <input type='checkbox' checked={fillExisting} onChange={(e) => setFillExisting(e.target.checked)} style={{ marginTop: 2, accentColor: tealDeep }} />
                <span><strong>Fill in missing details</strong> of suppliers already in your list from this file. Only blank details are filled; nothing you have is overwritten.</span>
              </label>
            )}
            <div role='tablist' aria-label='Rows to show' style={{ display: 'flex', gap: 16, borderBottom: `1px solid ${border}` }}>
              {VIEWS.map(([v, label]) => (
                <button key={v} type='button' role='tab' aria-selected={view === v} onClick={() => setView(v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 2px', marginBottom: -1, fontSize: 13, fontWeight: view === v ? 800 : 600, color: view === v ? tealDeep : gray600, borderBottom: view === v ? `2px solid ${tealDeep}` : '2px solid transparent' }}>
                  {label}{v === 'attention' ? ` (${s.attention})` : v === 'ready' ? ` (${toSave})` : ` (${s.rows})`}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <div style={{ fontSize: 13, color: gray500, padding: '8px 0' }}>{view === 'attention' ? 'Nothing needs attention.' : 'No rows to show.'}</div>
            ) : (
              <ul aria-label='Rows in the file' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {shown.map((r) => <PreviewRow key={r.row} r={r} />)}
              </ul>
            )}
          </>
        )}

        {step === 'done' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Notice tone={result.failed.length || result.attention ? 'warning' : 'success'}>
              <strong>{result.added} supplier{result.added === 1 ? '' : 's'} added{result.filled ? `, ${result.filled} updated with missing details` : ''}.</strong>
              {result.skipped ? ` ${result.skipped} skipped because they were added meanwhile.` : ''}
              {result.attention ? ` ${result.attention} row${result.attention === 1 ? '' : 's'} were not imported (needed fixing or repeated).` : ''}
            </Notice>
            {result.failed.length > 0 && (
              <Notice tone='danger'>
                Not saved: {result.failed.flatMap((f) => f.names).slice(0, 10).join(', ')}{result.failed.flatMap((f) => f.names).length > 10 ? '…' : ''} ({result.failed[0].message}). Upload them again.
              </Notice>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function PreviewRow({ r }) {
  const bad = r.status === 'error'
  const st = IMPORT_STATUS[r.status]
  const notes = [r.message, ...r.warnings].filter(Boolean)
  const record = r.record || {}
  return (
    <li style={{ border: `1px solid ${bad ? danger : border}`, borderRadius: theme.radius.md, padding: '10px 12px', background: bad ? dangerBg : 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: navy, overflowWrap: 'anywhere' }}>Row {r.row}: {r.name || 'No supplier name'}</div>
          {r.status === 'new' && (record.phone || record.email || record.contact_person) && (
            <div style={{ fontSize: 12, color: gray600, overflowWrap: 'anywhere' }}>{[record.contact_person, record.phone, record.email].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <Pill label={st.label} type={st.type} />
      </div>
      {notes.map((n, i) => (
        <div key={i} style={{ marginTop: 6, fontSize: 12, color: bad ? danger : (r.status === 'exists' || r.status === 'fill' ? gray600 : (theme.amberText || warning)), lineHeight: 1.5 }}>{n}</div>
      ))}
    </li>
  )
}
