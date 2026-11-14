import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, Download, AlertTriangle, CheckCircle, FileSpreadsheet } from 'lucide-react'
import { readSpreadsheet } from '../../business-directory/services/importService'
import { downloadBlob } from '../../business-directory/services/exportService'
import { debtRepository } from '../repositories'
import {
  DEBT_IMPORT, MAX_DEBT_IMPORT_BYTES, MAX_DEBT_IMPORT_ROWS, readDebtTable, prepareDebtRows, mergeImportResult,
  buildDebtTemplateCsv, buildDebtTemplateXlsx,
} from '../debtImport'
import { isMissingObject } from '../../../lib/dbErrors'
import { fmt, todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading, Pill } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, border, danger, dangerBg, warning, warningBg, success } = theme

// Excel / CSV import of Receivables (direction 'owes_us') or Payables ('we_owe').
// Steps: choose a file → check (the database runs the whole import and rolls it back, so the preview shows exactly
// which customer or supplier each row will be linked to, which will be created, and which rows are duplicates or
// wrong) → import → result. Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §2.
export default function DebtImportModal({ brand, direction, title, onClose, onDone, repo = debtRepository }) {
  const cfg = DEBT_IMPORT[direction]
  const [step, setStep] = useState('choose') // choose | reading | preview | importing | done
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [missing, setMissing] = useState([])
  const [ignored, setIgnored] = useState([])
  const [prepared, setPrepared] = useState(null) // { payload, problems }
  const [preview, setPreview] = useState(null) // merged { rows, summary }
  const [allowDuplicates, setAllowDuplicates] = useState(false)
  const [result, setResult] = useState(null)
  const queryClient = useQueryClient()
  const busy = step === 'reading' || step === 'importing'
  const noun = cfg.partyNoun

  function reset() {
    setStep('choose'); setError(''); setFileName(''); setMissing([]); setIgnored([]); setPrepared(null); setPreview(null); setAllowDuplicates(false); setResult(null)
  }
  function close() { if (!busy) onClose() }

  async function downloadTemplate(format) {
    try {
      if (format === 'csv') downloadBlob(buildDebtTemplateCsv(direction), `CareHub_${cfg.sheet}_Template.csv`, 'text/csv;charset=utf-8')
      else downloadBlob(await buildDebtTemplateXlsx(direction), `CareHub_${cfg.sheet}_Template.xlsx`)
    } catch (e) {
      console.error('[debts] template download failed:', e)
      setError('Could not create the template. Please try again.')
    }
  }

  async function check(prep, dups) {
    if (!prep.payload.length) return mergeImportResult({ rows: [], summary: { rows: 0 } }, prep.problems)
    const r = await repo.importRows(brand.id, direction, prep.payload, { dryRun: true, allowDuplicates: dups })
    return mergeImportResult(r, prep.problems)
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setFileName(file.name); setStep('reading')
    try {
      const raw = await readSpreadsheet(file, { sheetName: cfg.sheet, columnCount: cfg.columns.length, maxBytes: MAX_DEBT_IMPORT_BYTES })
      const table = readDebtTable(raw, direction)
      setMissing(table.missing); setIgnored(table.ignored)
      if (table.missing.length) { setStep('preview'); return }
      const prep = prepareDebtRows(table.rows, { today: todayDate() })
      setPrepared(prep)
      const merged = await check(prep, false)
      console.info('[debts] import checked', { direction, ...merged.summary })
      setPreview(merged)
      setStep('preview')
    } catch (err) {
      console.error('[debts] import: could not check the file:', err?.message)
      setError(isMissingObject(err)
        ? 'Importing becomes available once the latest database update is applied.'
        : err?.message || 'Could not read the file. Use the CareHub template.')
      setStep('choose')
    }
  }

  async function toggleDuplicates(next) {
    setAllowDuplicates(next)
    try { setPreview(await check(prepared, next)) } catch (err) { setError(err?.message || 'Could not check the file again.') }
  }

  const s = preview?.summary || {}
  const toImport = (s.debts || 0) + (s.payments || 0)

  async function commit() {
    if (!toImport || busy) return
    setStep('importing')
    try {
      const r = await repo.importRows(brand.id, direction, prepared.payload, { dryRun: false, allowDuplicates })
      const merged = mergeImportResult(r, prepared.problems)
      console.info('[debts] imported', { direction, ...merged.summary })
      setResult(merged)
      setStep('done')
      // New customers, debts and supplier records: every screen that shows them reads again.
      for (const prefix of ['debts', 'clients', 'purchases', 'reports']) queryClient.invalidateQueries({ queryKey: [prefix] })
      onDone?.(merged)
    } catch (err) {
      // import_debts is one transaction: when it fails, nothing was saved.
      console.error('[debts] import failed:', err)
      setError((err?.message || 'The import failed.') + ' Nothing was saved; try again.')
      setStep('preview')
    }
  }

  const footer = step === 'preview' && preview ? (
    <>
      <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
      <TealBtn onClick={commit} disabled={!toImport} style={{ flex: 1, padding: '12px' }}>{toImport ? `Import ${toImport} row${toImport === 1 ? '' : 's'}` : 'Nothing to import'}</TealBtn>
    </>
  ) : step === 'done' ? <TealBtn onClick={close} style={{ flex: 1, padding: '12px' }}>Done</TealBtn>
    : <GhostBtn onClick={close} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>

  return (
    <Modal show onClose={close} title={title || `Import ${cfg.title.toLowerCase()} from Excel / CSV`} wide preventClose={busy} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {step === 'choose' && (
          <>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>
              One row per debt (<strong>{cfg.columns.find(c => c.key === 'amount').header}</strong>, with anything already paid), or per payment (only <strong>Amount Paid</strong>).
              Each row is linked to your existing {noun} {direction === 'owes_us' ? '(by phone, then by name)' : '(by name)'}; a {noun} you do not have yet is {direction === 'owes_us' ? 'created' : 'added'} once, never twice.
              You will see every row before anything is saved. Up to {MAX_DEBT_IMPORT_ROWS.toLocaleString()} rows per file.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <GhostBtn onClick={() => downloadTemplate('xlsx')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Excel template</GhostBtn>
              <GhostBtn onClick={() => downloadTemplate('csv')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> CSV template</GhostBtn>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 16px', borderRadius: theme.radius.lg, position: 'relative', border: `2px dashed ${border}`, cursor: 'pointer', textAlign: 'center' }}>
              <Upload size={28} color={tealDeep} aria-hidden='true' />
              <span style={{ fontWeight: 700, color: navy, fontSize: 14 }}>Choose an .xlsx or .csv file</span>
              <span style={{ fontSize: 12, color: gray500 }}>Required: {cfg.columns.find(c => c.key === 'party').header}, and an amount owed or paid</span>
              <input type='file' accept='.xlsx,.csv,.txt' onChange={onFile} aria-label={`${cfg.title} file to import`} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
            </label>
            {error && <Notice tone='danger'>{error}</Notice>}
          </>
        )}

        {step === 'reading' && <Loading text={'Checking ' + fileName + '…'} />}
        {step === 'importing' && <Loading text='Importing… keep this page open.' />}

        {step === 'preview' && missing.length > 0 && (
          <Notice tone='danger'>{fileName} is missing <strong>{missing.join(', ')}</strong>. Use the CareHub template, or rename your headers to match it.</Notice>
        )}

        {step === 'preview' && preview && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: navy, fontWeight: 700 }}>
              <FileSpreadsheet size={16} color={tealDeep} aria-hidden='true' /> {fileName}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
              <Stat label='Debts to add' value={s.debts || 0} tone='success' />
              <Stat label='Payments' value={s.payments || 0} tone='success' />
              <Stat label={direction === 'owes_us' ? 'New customers' : 'New suppliers'} value={(direction === 'owes_us' ? s.clients_created : s.suppliers_created) || 0} />
              <Stat label='Need fixing' value={s.errors || 0} tone={s.errors ? 'danger' : undefined} />
              <Stat label='Owed (ready)' value={fmt(s.amount || 0)} />
              <Stat label='Paid (ready)' value={fmt(s.paid || 0)} />
            </div>
            {ignored.length > 0 && <div style={{ fontSize: 12, color: gray500 }}>Columns not used: {ignored.join(', ')}.</div>}
            {error && <Notice tone='danger'>{error}</Notice>}
            {s.errors > 0 && <Notice tone='danger'>{s.errors} row{s.errors === 1 ? '' : 's'} will not be imported until fixed. The others can be imported now; fix the file and upload just those rows later.</Notice>}
            {(s.duplicates > 0 || allowDuplicates) && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: 12.5, color: navy, cursor: 'pointer' }}>
                <input type='checkbox' checked={allowDuplicates} onChange={e => toggleDuplicates(e.target.checked)} style={{ marginTop: 2, accentColor: tealDeep }} />
                <span>{allowDuplicates
                  ? 'Rows that look already recorded will be imported again. Untick to skip them.'
                  : <>{s.duplicates} row{s.duplicates === 1 ? ' looks' : 's look'} already recorded (same reference, or same {noun}, amount, description and dates) and will be <strong>skipped</strong>. Tick to import {s.duplicates === 1 ? 'it' : 'them'} anyway.</>}</span>
              </label>
            )}
            <ul aria-label='Rows in the file' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
              {preview.rows.map((r, i) => <ImportRow key={`${r.row}-${i}`} r={r} noun={noun} />)}
            </ul>
          </>
        )}

        {step === 'done' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Notice tone={result.summary.errors ? 'warning' : 'success'}>
              <strong>{result.summary.debts || 0} debt{result.summary.debts === 1 ? '' : 's'} and {result.summary.payments || 0} payment{result.summary.payments === 1 ? '' : 's'} imported.</strong>
              {' '}{(direction === 'owes_us' ? result.summary.clients_created : result.summary.suppliers_created) || 0} new {noun}{((direction === 'owes_us' ? result.summary.clients_created : result.summary.suppliers_created) || 0) === 1 ? '' : 's'}, {result.summary.matched || 0} linked to existing {noun}s
              {result.summary.duplicates ? `, ${result.summary.duplicates} skipped as already recorded` : ''}{result.summary.errors ? `, ${result.summary.errors} not imported (see below)` : ''}.
            </Notice>
            {result.summary.errors > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: navy }}>
                {result.rows.filter(r => r.status === 'error').map((r, i) => <li key={i}>Row {r.row}{r.party ? ` (${r.party})` : ''}: {r.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

const MATCH = {
  owes_us: { phone: 'Existing customer (phone)', name: 'Existing customer', created: 'New customer' },
  we_owe: { name: 'Existing supplier', created: 'New supplier' },
}

function ImportRow({ r, noun }) {
  const bad = r.status === 'error'
  const status = bad ? { label: 'Needs fixing', type: 'red' } : r.status === 'duplicate' ? { label: 'Skipped: already recorded', type: 'amber' } : { label: r.kind === 'payment' ? 'Payment' : 'Debt', type: 'green' }
  const match = r.matched_by ? (MATCH[noun === 'customer' ? 'owes_us' : 'we_owe'][r.matched_by] || r.matched_by) : null
  return (
    <li style={{ border: `1px solid ${bad ? danger : border}`, borderRadius: theme.radius.md, padding: '10px 12px', background: bad ? dangerBg : 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: navy }}>Row {r.row}: {r.party || `No ${noun} name`}</div>
          <div style={{ fontSize: 12, color: gray600 }}>
            {Number(r.amount) > 0 && <>owed {fmt(r.amount)}</>}{Number(r.amount) > 0 && Number(r.paid) > 0 && ' · '}{Number(r.paid) > 0 && <>paid {fmt(r.paid)}</>}
            {match && <> · {match}</>}
          </div>
        </div>
        <Pill label={status.label} type={status.type} />
      </div>
      {(r.message || r.note) && <div style={{ marginTop: 6, fontSize: 12, color: bad ? danger : (theme.amberText || warning), lineHeight: 1.5 }}>{r.message || r.note}</div>}
    </li>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'danger' ? danger : tone === 'success' ? success : navy
  return (
    <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: tealMist }}>
      <div style={{ fontSize: 11, color: gray500, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function Notice({ tone, children }) {
  const c = tone === 'danger' ? { bg: dangerBg, fg: danger, Icon: AlertTriangle } : tone === 'warning' ? { bg: warningBg, fg: warning, Icon: AlertTriangle } : { bg: tealMist, fg: tealDeep, Icon: CheckCircle }
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: c.bg, border: `1px solid ${c.fg}`, fontSize: 12.5, color: navy, lineHeight: 1.5 }}>
      <c.Icon size={15} color={c.fg} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
      <div>{children}</div>
    </div>
  )
}
