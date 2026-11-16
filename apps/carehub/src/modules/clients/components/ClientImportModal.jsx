import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, Download, FileSpreadsheet } from 'lucide-react'
import { readSpreadsheet } from '../../business-directory/services/importService'
import { downloadBlob } from '../../business-directory/services/exportService'
import { debtRepository } from '../../debts/repositories'
import {
  CLIENT_SHEET, CLIENT_IMPORT_FIELDS, MAX_CLIENT_IMPORT_BYTES, MAX_CLIENT_IMPORT_ROWS, BALANCE_TYPES,
  readClientTable, prepareClientImport, commitClientImport, buildClientTemplateCsv, buildClientTemplateXlsx,
} from '../clientImport'
import { fmt, todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading, Pill } from '../../../components/ui'
import { Notice, Stat } from '../../debts/components/DebtImportModal'

const { tealDeep, navy, gray600, gray500, border, danger, dangerBg, warning, success } = theme
const STATUS = { new: ['New client', 'green'], exists: ['Already in your list', 'gray'], duplicate: ['Repeated in file', 'amber'], error: ['Needs fixing', 'red'] }
const VIEWS = [['all', 'All rows'], ['attention', 'Needs attention'], ['ready', 'Ready']]

// Upload clients from Excel / CSV, with opening balances. Steps: choose a file → preview (every row checked; nothing
// saved yet) → import → result. Opening balances are recorded as opening entries on each client's account
// (clientImport.js), never as sales or payments. Docs: docs/architecture/Client-Position-and-Opening-Balances.md.
export default function ClientImportModal({ brand, clients, createMany, allowOpenings = true, onClose, onDone, debtRepo = debtRepository }) {
  const [step, setStep] = useState('choose') // choose | reading | preview | importing | done
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState(null)
  const [view, setView] = useState('all')
  const [result, setResult] = useState(null)
  const queryClient = useQueryClient()
  const busy = step === 'reading' || step === 'importing'
  const preview = useMemo(() => (table && !table.missing.length ? prepareClientImport(table.rows, { clients, today: todayDate(), allowOpenings }) : null), [table, clients, allowOpenings])
  const s = preview?.summary || {}
  const openingsToAdd = (preview?.items || []).filter((i) => i.opening && (i.status === 'new' || i.status === 'exists')).length
  const canImport = (s.new || 0) + openingsToAdd > 0
  const shown = (preview?.items || []).filter((i) => view === 'all'
    || (view === 'ready' ? (i.status === 'new' || (i.status === 'exists' && i.opening)) : (i.status === 'error' || i.status === 'duplicate' || i.warnings.length)))

  function reset() { setStep('choose'); setError(''); setFileName(''); setTable(null); setView('all'); setResult(null) }
  function close() { if (!busy) onClose() }

  async function downloadTemplate(format) {
    try {
      if (format === 'csv') downloadBlob(buildClientTemplateCsv(), 'CareHub_Clients_Template.csv', 'text/csv;charset=utf-8')
      else downloadBlob(await buildClientTemplateXlsx(), 'CareHub_Clients_Template.xlsx')
    } catch (e) {
      console.error('[clients] template download failed:', e)
      setError('Could not create the template. Please try again.')
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setFileName(file.name); setStep('reading')
    try {
      const raw = await readSpreadsheet(file, { sheetName: CLIENT_SHEET, columnCount: CLIENT_IMPORT_FIELDS.length, maxBytes: MAX_CLIENT_IMPORT_BYTES })
      const t = readClientTable(raw)
      setTable(t)
      setStep('preview')
      console.info('[clients] import file read', { rows: t.rows.length, missing: t.missing })
    } catch (err) {
      console.error('[clients] import: could not read the file:', err?.message)
      setError(err?.message || 'Could not read the file. Use the CareHub template.')
      setStep('choose')
    }
  }

  async function commit() {
    if (!canImport || busy) return
    setStep('importing')
    try {
      const r = await commitClientImport(brand.id, preview.items, { createMany, debtRepo })
      console.info('[clients] imported', { added: r.added, skipped: r.skipped, failed: r.failed.length, openings: r.openings.recorded.length, openingsAlready: r.openings.already.length })
      if (r.failed.length || r.openings.failed.length) console.error('[clients] import: some rows were not saved', [...r.failed, ...r.openings.failed].map((f) => f.message))
      setResult({ ...r, notImported: (s.errors || 0) + (s.duplicate || 0) })
      setStep('done')
      // New clients and opening entries: client lists, positions and Debts read again.
      for (const prefix of ['clients', 'debts']) queryClient.invalidateQueries({ queryKey: [prefix] })
      onDone?.(r)
    } catch (err) {
      console.error('[clients] import failed:', err)
      setError((err?.message || 'The import failed.') + ' Try again: clients already saved are matched by phone and not added twice.')
      setStep('preview')
    }
  }

  const footer = step === 'preview' && preview ? (
    <>
      <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
      <TealBtn onClick={commit} disabled={!canImport} style={{ flex: 1, padding: '12px' }}>{canImport ? `Import ${s.new} client${s.new === 1 ? '' : 's'}${openingsToAdd ? ` and ${openingsToAdd} opening balance${openingsToAdd === 1 ? '' : 's'}` : ''}` : 'Nothing to import'}</TealBtn>
    </>
  ) : step === 'importing' ? <TealBtn disabled style={{ flex: 1, padding: '12px' }}>Importing…</TealBtn>
    : step === 'preview' ? <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
      : step === 'done' ? <TealBtn onClick={close} style={{ flex: 1, padding: '12px' }}>Done</TealBtn>
        : <GhostBtn onClick={close} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>

  return (
    <Modal show onClose={close} title='Upload clients from Excel / CSV' wide preventClose={busy} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {step === 'choose' && (
          <>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>
              One row per client: <strong>Client Name</strong> and <strong>Phone Number</strong>, the address, and any <strong>opening balance</strong> from before CareHub
              (<em>{BALANCE_TYPES.owes_us}</em> or <em>{BALANCE_TYPES.we_owe}</em>, with its date). Opening balances go on the client's account as opening entries, not as sales or payments.
              Clients are matched by phone number, so nobody is added twice. You will see every row before anything is saved. Up to {MAX_CLIENT_IMPORT_ROWS.toLocaleString()} rows per file.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <GhostBtn onClick={() => downloadTemplate('xlsx')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Excel template</GhostBtn>
              <GhostBtn onClick={() => downloadTemplate('csv')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> CSV template</GhostBtn>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 16px', borderRadius: theme.radius.lg, position: 'relative', border: `2px dashed ${border}`, cursor: 'pointer', textAlign: 'center' }}>
              <Upload size={28} color={tealDeep} aria-hidden='true' />
              <span style={{ fontWeight: 700, color: navy, fontSize: 14 }}>Choose an .xlsx or .csv file</span>
              <span style={{ fontSize: 12, color: gray500 }}>Required: Client Name and Phone Number</span>
              <input type='file' accept='.xlsx,.csv,.txt' onChange={onFile} aria-label='Client file to import' style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
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
              <Stat label='New clients' value={s.new} tone='success' />
              <Stat label='Already in list' value={s.exists} />
              <Stat label='Repeated in file' value={s.duplicate} tone={s.duplicate ? 'danger' : undefined} />
              <Stat label='Need fixing' value={s.errors} tone={s.errors ? 'danger' : undefined} />
              <Stat label='Client owes us (opening)' value={fmt(s.owesUs || 0)} />
              <Stat label='We owe clients (opening)' value={fmt(s.weOwe || 0)} />
            </div>
            {table.ignored.length > 0 && <div style={{ fontSize: 12, color: gray500 }}>Columns not used: {table.ignored.join(', ')}.</div>}
            {error && <Notice tone='danger'>{error}</Notice>}
            {s.errors > 0 && <Notice tone='danger'>{s.errors} row{s.errors === 1 ? '' : 's'} will not be imported until fixed. The others can be imported now; fix the file and upload just those rows later.</Notice>}
            <div role='tablist' aria-label='Rows to show' style={{ display: 'flex', gap: 16, borderBottom: `1px solid ${border}` }}>
              {VIEWS.map(([v, label]) => (
                <button key={v} type='button' role='tab' aria-selected={view === v} onClick={() => setView(v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 2px', marginBottom: -1, fontSize: 13, fontWeight: view === v ? 800 : 600, color: view === v ? tealDeep : gray600, borderBottom: view === v ? `2px solid ${tealDeep}` : '2px solid transparent' }}>
                  {label} ({v === 'attention' ? s.attention : v === 'ready' ? (s.new || 0) + (preview.items.filter((i) => i.status === 'exists' && i.opening).length) : s.rows})
                </button>
              ))}
            </div>
            {shown.length === 0 ? <div style={{ fontSize: 13, color: gray500, padding: '8px 0' }}>{view === 'attention' ? 'Nothing needs attention.' : 'No rows to show.'}</div> : (
              <ul aria-label='Rows in the file' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {shown.map((r) => <PreviewRow key={r.row} r={r} />)}
              </ul>
            )}
          </>
        )}

        {step === 'done' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Notice tone={result.failed.length || result.openings.failed.length || result.notImported ? 'warning' : 'success'}>
              <strong>{result.added} client{result.added === 1 ? '' : 's'} added{result.openings.recorded.length ? `, ${result.openings.recorded.length} opening balance${result.openings.recorded.length === 1 ? '' : 's'} recorded` : ''}.</strong>
              {result.skipped ? ` ${result.skipped} skipped: their phone number was added meanwhile (upload again to add their opening balance).` : ''}
              {result.openings.already.length ? ` ${result.openings.already.length} already had an opening balance, so it was not added again: ${result.openings.already.slice(0, 5).join(', ')}.` : ''}
              {result.notImported ? ` ${result.notImported} row${result.notImported === 1 ? ' was' : 's were'} not imported (needed fixing or repeated).` : ''}
            </Notice>
            {(result.failed.length > 0 || result.openings.failed.length > 0) && (
              <Notice tone='danger'>
                Not saved: {[...result.failed.map((f) => f.full_name), ...result.openings.failed.map((f) => f.name + ' (opening balance)')].slice(0, 8).join(', ')}. Upload them again.
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
  const [label, type] = STATUS[r.status]
  return (
    <li style={{ border: `1px solid ${bad ? danger : border}`, borderRadius: theme.radius.md, padding: '10px 12px', background: bad ? dangerBg : 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: navy, overflowWrap: 'anywhere' }}>Row {r.row}: {r.name || 'No name'}</div>
          <div style={{ fontSize: 12, color: gray600 }}>
            {r.phone || 'No phone'}
            {r.opening && <> · opening balance <strong style={{ color: r.opening.direction === 'owes_us' ? danger : success }}>{r.opening.direction === 'owes_us' ? 'Client owes us' : 'We owe client'} {fmt(r.opening.amount)}</strong> on {r.opening.date}</>}
          </div>
        </div>
        <Pill label={label} type={type} />
      </div>
      {[r.message, ...r.warnings].filter(Boolean).map((n, i) => (
        <div key={i} style={{ marginTop: 6, fontSize: 12, color: bad ? danger : r.status === 'exists' ? gray600 : (theme.amberText || warning), lineHeight: 1.5 }}>{n}</div>
      ))}
    </li>
  )
}
