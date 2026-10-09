import { useMemo, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Card, TealBtn, GhostBtn, Pill, Sel, Inp, Modal, Empty } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import {
  buildTemplateCsv, buildTemplateXlsx, readSpreadsheet, readTable, analyseImport, summarise, planCommit,
  commitImport, allowedResolutions, defaultResolution, ITEM_STATUS, TEMPLATE_COLUMNS,
} from '../services/importService'
import { RESOLUTION } from '../services/deduplication'
import { downloadBlob } from '../services/exportService'

const { navy, gray500, gray600, border, tealDeep, danger, warning, success } = theme

const STATUS_META = {
  [ITEM_STATUS.NEW]: { label: 'New', type: 'green' },
  [ITEM_STATUS.REVIEW]: { label: 'Needs review', type: 'amber' },
  [ITEM_STATUS.POSSIBLE]: { label: 'Possible duplicate', type: 'amber' },
  [ITEM_STATUS.CONFIRMED]: { label: 'Duplicate', type: 'red' },
  [ITEM_STATUS.INVALID]: { label: 'Invalid', type: 'red' },
}
const RESOLUTION_LABEL = {
  [RESOLUTION.KEEP_EXISTING]: 'Keep existing',
  [RESOLUTION.IMPORT_NEW]: 'Import as new',
  [RESOLUTION.MERGE]: 'Merge into existing',
  [RESOLUTION.SKIP]: 'Skip',
}
const PAGE = 50

function Tile({ label, value, tone, active, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, cursor: 'pointer', minWidth: 120, border: `1px solid ${active ? tealDeep : border}`, background: active ? theme.tealMist : 'white' }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: tone || navy }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: gray600 }}>{label}</div>
    </button>
  )
}

/**
 * Upload -> preview/review -> import. Nothing touches the database until the
 * administrator presses Import in step 2; every step is cancellable.
 */
export default function ImportWizard({ businessId, scope, repo, categories, subcategories, loadExisting, createdBy, onImported, showToast }) {
  const [step, setStep] = useState('upload') // upload | working | review | importing | done
  const [fileName, setFileName] = useState('')
  const [notes, setNotes] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [progress, setProgress] = useState({ phase: '', done: 0, total: 0 })
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [fixing, setFixing] = useState(null) // {index, cells}
  const cancelRef = useRef(false)
  const existingRef = useRef(null)
  const decisions = useRef({}) // rowNumber -> resolution chosen by a human

  const summary = useMemo(() => summarise(items), [items])
  const plan = useMemo(() => planCommit(items), [items])
  const shown = useMemo(() => items.filter((it) => filter === 'all' || it.status === filter), [items, filter])
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)
  const catName = (id) => categories.find((c) => c.id === id)?.name || ''

  async function runAnalysis(rows) {
    cancelRef.current = false
    setStep('working')
    setError('')
    try {
      if (!existingRef.current) {
        setProgress({ phase: 'loading existing directory', done: 0, total: 0 })
        existingRef.current = await loadExisting()
      }
      const out = await analyseImport(rows, {
        categories, subcategories, existing: existingRef.current,
        onProgress: (phase, done, total) => setProgress({ phase, done, total }),
        shouldCancel: () => cancelRef.current,
      })
      out.forEach((it) => {
        const d = decisions.current[it.rowNumber]
        if (d && allowedResolutions(it).includes(d)) it.resolution = d
      })
      setItems(out)
      setFilter('all')
      setPage(0)
      setStep('review')
    } catch (e) {
      if (e.message === 'cancelled') { setStep('upload'); return }
      setError(e.message)
      setStep('upload')
    }
  }

  async function onFile(file) {
    if (!file) return
    setError('')
    setNotes([])
    decisions.current = {}
    existingRef.current = null
    setFileName(file.name)
    setStep('working')
    setProgress({ phase: 'reading file', done: 0, total: 0 })
    try {
      const table = readTable(await readSpreadsheet(file))
      if (table.missing.length) throw new Error('The file is missing required column(s): ' + table.missing.join(', ') + '. Download the template and keep its headers.')
      if (!table.rows.length) throw new Error('The file has headers but no businesses in it.')
      if (table.unknown.length) setNotes(['Ignored column(s) not in the template: ' + table.unknown.join(', ')])
      setRawRows(table.rows)
      await runAnalysis(table.rows)
    } catch (e) {
      setError(e.message)
      setStep('upload')
    }
  }

  function decide(item, resolution) {
    decisions.current[item.rowNumber] = resolution
    setItems((prev) => prev.map((it) => (it.rowNumber === item.rowNumber ? { ...it, resolution } : it)))
  }

  function bulk(status, resolution) {
    setItems((prev) => prev.map((it) => {
      if (it.status !== status || !allowedResolutions(it).includes(resolution)) return it
      decisions.current[it.rowNumber] = resolution
      return { ...it, resolution }
    }))
  }

  async function saveFix() {
    const next = rawRows.map((r, i) => (i === fixing.index ? fixing.cells : r))
    setRawRows(next)
    setFixing(null)
    await runAnalysis(next)
  }

  function downloadInvalid() {
    const bad = items.filter((it) => it.status === ITEM_STATUS.INVALID)
    const head = [...TEMPLATE_COLUMNS.map((c) => c.header), 'Row', 'Problems']
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const lines = [head.map(esc).join(',')].concat(bad.map((it) =>
      [...TEMPLATE_COLUMNS.map((c) => it.raw[c.key] ?? ''), it.rowNumber, it.errors.map((e) => e.message).join(' | ')].map(esc).join(',')))
    downloadBlob('﻿' + lines.join('\r\n'), 'invalid-rows.csv', 'text/csv;charset=utf-8')
  }

  async function doImport() {
    cancelRef.current = false
    setStep('importing')
    setProgress({ phase: 'importing', done: 0, total: plan.inserts.length + plan.merges.length })
    try {
      const r = await commitImport({
        items, repo, businessId, scope, createdBy, fileName,
        onProgress: (phase, done, total) => setProgress({ phase, done, total }),
        shouldCancel: () => cancelRef.current,
      })
      setResult(r)
      setStep('done')
      onImported && onImported(r)
    } catch (e) {
      setError(e.message)
      setStep('review')
      onImported && onImported(e.partial || null)
    }
  }

  async function downloadTemplate(kind) {
    try {
      if (kind === 'csv') downloadBlob(buildTemplateCsv(), 'carehub-business-import-template.csv', 'text/csv;charset=utf-8')
      else downloadBlob(await buildTemplateXlsx(categories), 'carehub-business-import-template.xlsx')
    } catch (e) { showToast('Could not build the template: ' + e.message, { type: 'error' }) }
  }

  function reset() {
    setStep('upload'); setItems([]); setRawRows([]); setResult(null); setError(''); setFileName(''); setNotes([])
    decisions.current = {}; existingRef.current = null
  }

  // ── Steps ──────────────────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <Card style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: navy, marginBottom: 4 }}>Import businesses from Excel or CSV</div>
        <ol style={{ fontSize: 13, color: gray600, lineHeight: 1.8, paddingLeft: 18, margin: '0 0 14px' }}>
          <li>Download the official template and fill it in (up to 20,000 rows).</li>
          <li>Upload it. Nothing is saved yet — you will see a preview with valid, invalid and duplicate counts.</li>
          <li>Resolve possible duplicates, then confirm the import.</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <GhostBtn onClick={() => downloadTemplate('xlsx')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Download size={14} aria-hidden='true' /> Download Business Import Template (.xlsx)</GhostBtn>
          <GhostBtn onClick={() => downloadTemplate('csv')}>Template (.csv)</GhostBtn>
        </div>
        {error && <div role='alert' style={{ color: danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
        <label style={{ display: 'block', padding: 28, textAlign: 'center', border: `2px dashed ${border}`, borderRadius: 14, cursor: 'pointer', color: gray500 }}>
          <Upload size={22} aria-hidden='true' />
          <div style={{ fontWeight: 800, color: navy, marginTop: 6 }}>Choose an .xlsx or .csv file</div>
          <div style={{ fontSize: 12 }}>Only real, verifiable businesses should be imported.</div>
          <input type='file' accept='.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            onChange={(e) => { onFile(e.target.files[0]); e.target.value = '' }} aria-label='Choose import file' />
        </label>
      </Card>
    )
  }

  if (step === 'working' || step === 'importing') {
    const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null
    return (
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: navy, textTransform: 'capitalize' }}>{progress.phase || 'working'}…</div>
        <div role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label='Import progress'
          style={{ height: 10, borderRadius: 6, background: theme.gray200, margin: '12px 0', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: (pct ?? 8) + '%', background: tealDeep, transition: 'width .2s' }} />
        </div>
        <div aria-live='polite' style={{ fontSize: 12.5, color: gray600 }}>
          {progress.total ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : 'Please wait'}
          {step === 'importing' && ' — keep this tab open. If it stops, re-uploading the same file is safe: imported rows are detected as duplicates.'}
        </div>
        <GhostBtn onClick={() => { cancelRef.current = true }} style={{ marginTop: 12 }}>Cancel</GhostBtn>
      </Card>
    )
  }

  if (step === 'done' && result) {
    return (
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: success }}>{result.cancelled ? 'Import cancelled' : 'Import complete'}</div>
        <div style={{ fontSize: 13.5, color: navy, margin: '10px 0 16px', lineHeight: 1.8 }}>
          {result.imported.toLocaleString()} new business{result.imported === 1 ? '' : 'es'} added
          {result.merged > 0 && <> · {result.merged} existing record{result.merged === 1 ? '' : 's'} updated</>}
          {' '}· {(result.skipped + result.keptExisting).toLocaleString()} skipped or kept as they were.
        </div>
        <TealBtn onClick={reset}>Import another file</TealBtn>
      </Card>
    )
  }

  // review
  const blocked = plan.unresolved > 0
  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: navy, marginBottom: 2 }}>{fileName}</div>
        <div style={{ fontSize: 13, color: gray600, marginBottom: 12 }}>
          {summary.total.toLocaleString()} records detected · {summary.new.toLocaleString()} new businesses · {summary.possible} possible duplicates · {summary.confirmed} duplicates · {summary.invalid} invalid · {summary.review} requiring review
        </div>
        {notes.map((n) => <div key={n} style={{ fontSize: 12, color: warning, marginBottom: 6 }}>{n}</div>)}
        {summary.withoutCoordinates > 0 && (
          <div style={{ fontSize: 12, color: gray500, marginBottom: 8 }}>
            {summary.withoutCoordinates.toLocaleString()} record(s) have no coordinates. They will be saved but will not appear in distance/radius searches until coordinates are added.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Tile label='All records' value={summary.total} active={filter === 'all'} onClick={() => { setFilter('all'); setPage(0) }} />
          <Tile label='New' value={summary.new} tone={success} active={filter === ITEM_STATUS.NEW} onClick={() => { setFilter(ITEM_STATUS.NEW); setPage(0) }} />
          <Tile label='Needs review' value={summary.review} tone={warning} active={filter === ITEM_STATUS.REVIEW} onClick={() => { setFilter(ITEM_STATUS.REVIEW); setPage(0) }} />
          <Tile label='Possible duplicates' value={summary.possible} tone={warning} active={filter === ITEM_STATUS.POSSIBLE} onClick={() => { setFilter(ITEM_STATUS.POSSIBLE); setPage(0) }} />
          <Tile label='Duplicates' value={summary.confirmed} tone={danger} active={filter === ITEM_STATUS.CONFIRMED} onClick={() => { setFilter(ITEM_STATUS.CONFIRMED); setPage(0) }} />
          <Tile label='Invalid' value={summary.invalid} tone={danger} active={filter === ITEM_STATUS.INVALID} onClick={() => { setFilter(ITEM_STATUS.INVALID); setPage(0) }} />
        </div>
        {error && <div role='alert' style={{ color: danger, fontSize: 13, marginTop: 10 }}>{error}</div>}
      </Card>

      {(filter === ITEM_STATUS.POSSIBLE || summary.possible > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: gray600 }}>All {summary.possible} possible duplicates:</span>
          <GhostBtn onClick={() => bulk(ITEM_STATUS.POSSIBLE, RESOLUTION.SKIP)}>Skip all</GhostBtn>
          <GhostBtn onClick={() => bulk(ITEM_STATUS.POSSIBLE, RESOLUTION.KEEP_EXISTING)}>Keep existing</GhostBtn>
          <GhostBtn onClick={() => bulk(ITEM_STATUS.POSSIBLE, RESOLUTION.IMPORT_NEW)}>Import all as new</GhostBtn>
        </div>
      )}
      {summary.invalid > 0 && <GhostBtn onClick={downloadInvalid} style={{ marginBottom: 10 }}>Download invalid rows (.csv) to correct and re-upload</GhostBtn>}

      <Card style={{ padding: 0, overflowX: 'auto' }}>
        {pageRows.length === 0 ? <Empty message='No records in this group.' cause='filtered' /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820 }}>
            <thead>
              <tr style={{ background: theme.gray50, textAlign: 'left' }}>
                {['Row', 'Status', 'Business', 'Address', 'Issues / match', 'Decision'].map((h) => <th key={h} scope='col' style={{ padding: '9px 10px', fontSize: 11, color: gray500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((it) => {
                const meta = STATUS_META[it.status]
                const opts = allowedResolutions(it)
                return (
                  <tr key={it.rowNumber} style={{ borderTop: `1px solid ${border}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '8px 10px', color: gray500 }}>{it.rowNumber}</td>
                    <td style={{ padding: '8px 10px' }}><Pill label={meta.label} type={meta.type} /></td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ fontWeight: 700, color: navy }}>{it.record.name || <em>(no name)</em>}</div>
                      <div style={{ color: gray500 }}>{catName(it.record.category_id) || it.raw.category}</div>
                    </td>
                    <td style={{ padding: '8px 10px', color: gray600 }}>{[it.record.address, it.record.state].filter(Boolean).join(', ')}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12 }}>
                      {it.errors.map((e, i) => <div key={'e' + i} style={{ color: danger }}>{e.message}</div>)}
                      {it.warnings.map((w, i) => <div key={'w' + i} style={{ color: warning }}>{w.message}</div>)}
                      {it.match && (
                        <div style={{ color: gray600 }}>
                          {it.in_file ? 'Also in this file (row ' + String(it.match.id).replace('file:', '') + ')' : 'Matches “' + it.match.name + '”'} — {it.reasons.join(', ')}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', minWidth: 170 }}>
                      {it.status === ITEM_STATUS.INVALID ? (
                        <GhostBtn onClick={() => setFixing({ index: it.rowNumber - 2, cells: { ...rawRows[it.rowNumber - 2] } })}>Fix row</GhostBtn>
                      ) : (
                        <select aria-label={'Decision for row ' + it.rowNumber} value={it.resolution || ''} onChange={(e) => decide(it, e.target.value)}
                          style={{ width: '100%', padding: '8px', borderRadius: 8, border: `1px solid ${it.resolution ? border : warning}`, fontSize: 12.5, background: 'white' }}>
                          {!it.resolution && <option value=''>Choose…</option>}
                          {opts.map((o) => <option key={o} value={o}>{RESOLUTION_LABEL[o]}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {shown.length > PAGE && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0', fontSize: 12.5, color: gray600 }}>
          <GhostBtn onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</GhostBtn>
          <span>{page * PAGE + 1}–{Math.min(shown.length, (page + 1) * PAGE)} of {shown.length.toLocaleString()}</span>
          <GhostBtn onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE >= shown.length}>Next</GhostBtn>
        </div>
      )}

      <Card style={{ padding: 14, marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, color: navy }}>
          Will add <strong>{plan.inserts.length.toLocaleString()}</strong>
          {plan.merges.length > 0 && <>, update <strong>{plan.merges.length}</strong></>}
          {' '}and skip <strong>{(plan.skipped + plan.keptExisting).toLocaleString()}</strong>.
          {blocked && <span style={{ color: warning, fontWeight: 700 }}> {plan.unresolved} possible duplicate(s) still need a decision.</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={reset}>Start over</GhostBtn>
          <TealBtn onClick={doImport} disabled={blocked || (plan.inserts.length + plan.merges.length === 0)}>Import</TealBtn>
        </div>
      </Card>

      {fixing && (
        <Modal show onClose={() => setFixing(null)} wide title={'Fix row ' + (fixing.index + 2)}
          footer={<><GhostBtn onClick={() => setFixing(null)}>Cancel</GhostBtn><TealBtn onClick={saveFix}>Save and re-check</TealBtn></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {TEMPLATE_COLUMNS.map((c) => c.key === 'category' ? (
              <Sel key={c.key} label={c.header} required value={fixing.cells.category || ''}
                onChange={(v) => setFixing((p) => ({ ...p, cells: { ...p.cells, category: v } }))}
                options={[...(categories.some((x) => x.name === fixing.cells.category) || !fixing.cells.category ? [] : [fixing.cells.category]), ...categories.map((x) => x.name)]} />
            ) : (
              <Inp key={c.key} label={c.header} required={c.required} value={fixing.cells[c.key] || ''}
                onChange={(v) => setFixing((p) => ({ ...p, cells: { ...p.cells, [c.key]: v } }))} />
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            {items.find((it) => it.rowNumber === fixing.index + 2)?.errors.map((e, i) => <div key={i} style={{ color: danger, fontSize: 12 }}>{e.message}</div>)}
          </div>
        </Modal>
      )}
    </div>
  )
}
