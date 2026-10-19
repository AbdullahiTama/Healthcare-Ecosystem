import { useState, useEffect, useRef, useMemo } from 'react'
import { Download, FileUp } from 'lucide-react'
import { Button, Select, Pill, Loading, Empty, ErrorState, Toast, useToast } from '../../../components/ui'
import { directoryRepository as repo } from '../../../modules/directory/repositories'
import {
  parseCsv, autoMapColumns, buildImportPlan, defaultDecisions, selectRowsToImport,
  fileFingerprint, templateCsv, ROW_STATUS, IMPORT_FIELDS,
} from '../../../modules/directory/directoryImport'
import { runImport } from '../../../modules/directory/directoryImportRunner'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const STATUS_PILL = { new: 'green', needs_review: 'amber', possible_duplicate: 'amber', confirmed_duplicate: 'red', invalid: 'red' }
const STATUS_LABEL = { new: 'New', needs_review: 'Needs review', possible_duplicate: 'Possible duplicate', confirmed_duplicate: 'Confirmed duplicate', invalid: 'Invalid' }
const FILTERS = ['all', ...Object.values(ROW_STATUS)]

function downloadTemplate() {
  const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'directory-import-template.csv'
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

export default function DirectoryImport() {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const [step, setStep] = useState('choose') // choose | map | review | running | done
  const [categories, setCategories] = useState([])
  const [fileName, setFileName] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [table, setTable] = useState(null)
  const [mapping, setMapping] = useState({})
  const [plan, setPlan] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => { repo.listCategories().then(setCategories).catch(() => {}) }, [])
  useEffect(() => { repo.listImports(10).then(setHistory).catch(() => setHistory([])) }, [result])

  async function onFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (!/\.csv$/i.test(file.name)) { setError('Choose a .csv file. Excel files are not supported yet: save the sheet as CSV first.'); return }
    if (file.size > MAX_FILE_BYTES) { setError('That file is larger than 2 MB. Split it and import in parts.'); return }
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.error) { setError(parsed.error); return }
    if (parsed.rows.length < 2) { setError('The file has no data rows.'); return }
    setFileName(file.name); setFingerprint(fileFingerprint(text)); setTable(parsed.rows)
    setMapping(autoMapColumns(parsed.rows[0]).mapping)
    setStep('map')
  }

  async function buildPlan() {
    setBusy(true); setError('')
    try {
      // Cheap pre-check so a missing name column fails before any network use.
      const dry = buildImportPlan(table, { mapping, categories, existing: [], fingerprint })
      if (dry.error) { setError(dry.error); return }
      const existing = await repo.findCandidates(dry.rows.map((r) => r.record))
      const full = buildImportPlan(table, { mapping, categories, existing, fingerprint })
      setPlan(full); setDecisions(defaultDecisions(full.rows)); setFilter('all'); setStep('review')
    } catch (e) {
      setError('Could not check for duplicates: ' + (e.message || 'request failed') + '. Nothing was imported.')
    } finally { setBusy(false) }
  }

  const visible = useMemo(() => (plan ? plan.rows.filter((r) => filter === 'all' || r.status === filter) : []), [plan, filter])
  const toImport = plan ? selectRowsToImport(plan.rows, decisions).length : 0

  async function start() {
    setStep('running'); setResult(null); setError('')
    const ctl = new AbortController(); abortRef.current = ctl
    setProgress({ processed: 0, total: toImport, inserted: 0, failed: 0 })
    const res = await runImport({ planRows: plan.rows, decisions, repo, signal: ctl.signal, onProgress: setProgress })
    try {
      await repo.recordImport({
        fileName, fileFingerprint: fingerprint, counts: plan.counts,
        result: { total: res.total, inserted: res.inserted, alreadyImported: res.alreadyImported, failed: res.failed.slice(0, 200), cancelled: res.cancelled, denied: res.denied },
      })
    } catch (e) { showToast('Imported, but the history entry could not be saved: ' + e.message, { type: 'warning' }) }
    setResult(res); setStep('done')
  }

  function reset() { setStep('choose'); setTable(null); setPlan(null); setResult(null); setProgress(null); setError('') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{error}</div>}

      {step === 'choose' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--panel)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            Upload a CSV of businesses (up to 5,000 rows). You will review every row before anything is saved. Imported records always start as unverified.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" size="md" onClick={downloadTemplate}><Download size={14} aria-hidden="true" /> Download template</Button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: 'var(--teal)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <FileUp size={14} aria-hidden="true" /> Choose CSV file
              <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
            </label>
          </div>
          <ImportHistory history={history} />
        </div>
      )}

      {step === 'map' && table && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--panel)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>{fileName}</strong>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{table.length - 1} data rows. Check which column feeds each field.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {IMPORT_FIELDS.map((f) => (
              <Select key={f} label={f.replace('_', ' ')} required={f === 'name'} value={mapping[f] === undefined ? '' : String(mapping[f])} placeholder="Not in file"
                onChange={(v) => setMapping((m) => { const n = { ...m }; if (v === '') delete n[f]; else n[f] = Number(v); return n })}
                options={table[0].map((h, i) => ({ value: String(i), label: h || 'Column ' + (i + 1) }))} style={{ flex: '1 1 180px' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={reset}>Back</Button>
            <Button variant="primary" size="md" disabled={busy || mapping.name === undefined} onClick={buildPlan}>{busy ? 'Checking for duplicates...' : 'Check file'}</Button>
          </div>
        </div>
      )}

      {step === 'review' && plan && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Filter rows by status">
            {FILTERS.map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}
                style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: filter === f ? '1px solid var(--teal)' : '1px solid var(--border)', background: filter === f ? 'var(--teal-mist)' : 'var(--panel)', color: filter === f ? 'var(--teal)' : 'var(--muted)' }}>
                {f === 'all' ? 'All (' + plan.rows.length + ')' : STATUS_LABEL[f] + ' (' + (plan.counts[f] || 0) + ')'}
              </button>
            ))}
          </div>
          {visible.length === 0 ? <Empty title="No rows in this view" /> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 460, overflowY: 'auto' }}>
              {visible.slice(0, 300).map((r) => (
                <li key={r.row} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel)', padding: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>Row {r.row}: {r.record.name || '(no name)'}</div>
                    {Object.values(r.errors).map((m, i) => <div key={i} style={{ fontSize: 12, color: 'var(--danger, #b91c1c)' }}>{m}</div>)}
                    {r.warnings.map((m, i) => <div key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>{m}</div>)}
                    {r.candidates.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Matches {c.ref.id ? 'existing "' + c.ref.name + '"' + (c.ref.verification_status === 'verified' ? ' (verified)' : '') : 'row ' + c.ref.row + ' in this file'}: {c.reasons.join(', ')}
                      </div>
                    ))}
                  </div>
                  <Pill label={STATUS_LABEL[r.status]} type={STATUS_PILL[r.status]} />
                  {r.status !== ROW_STATUS.INVALID && (
                    <Select aria-label={'Decision for row ' + r.row} value={decisions[r.row] || 'skip'} placeholder="Skip"
                      onChange={(v) => setDecisions((d) => ({ ...d, [r.row]: v || 'skip' }))}
                      options={[{ value: 'import', label: 'Import as new' }, { value: 'skip', label: 'Skip' }, ...(r.candidates.some((c) => c.ref.id) ? [{ value: 'keep_existing', label: 'Keep existing' }] : [])]}
                      style={{ width: 150 }} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {visible.length > 300 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Showing the first 300 rows of this view. Use the filters to narrow it down.</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>
            <Button variant="primary" size="md" disabled={toImport === 0} onClick={start}>Import {toImport} {toImport === 1 ? 'row' : 'rows'}</Button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Duplicates and rows needing review are skipped unless you choose to import them.</span>
          </div>
        </>
      )}

      {step === 'running' && progress && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--panel)' }}>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.processed} aria-label="Import progress"
            style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: (progress.total ? (progress.processed / progress.total) * 100 : 0) + '%', background: 'var(--teal)', transition: 'width 150ms' }} />
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }} aria-live="polite">{progress.processed} of {progress.total} processed. {progress.inserted} saved{progress.failed ? ', ' + progress.failed + ' failed' : ''}.</div>
          <Button variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => abortRef.current && abortRef.current.abort()}>Stop after this batch</Button>
        </div>
      )}

      {step === 'done' && result && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--panel)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>{result.denied ? 'Import stopped: you are not permitted to add to the directory.' : result.cancelled ? 'Import stopped early.' : 'Import finished.'}</strong>
          <div style={{ fontSize: 13 }}>{result.inserted} saved · {result.alreadyImported} already imported earlier · {result.failed.length} failed · {Math.max(result.total - result.processed, 0)} not attempted</div>
          {result.failed.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, maxHeight: 200, overflowY: 'auto' }}>
              {result.failed.slice(0, 100).map((f) => <li key={f.row}>Row {f.row}: {f.message}</li>)}
            </ul>
          )}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>You can re-run the same file safely: rows already saved are recognised and not duplicated.</div>
          <Button variant="primary" size="md" onClick={reset}>Done</Button>
        </div>
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

function ImportHistory({ history }) {
  if (history === null) return <Loading text="Loading import history..." />
  if (history.length === 0) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>No imports yet.</div>
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Recent imports</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted)' }}>
        {history.map((h) => (
          <li key={h.id}>{new Date(h.created_at).toLocaleString()} · {h.file_name || 'file'} · {(h.result && h.result.inserted) || 0} saved, {(h.result && h.result.failed && h.result.failed.length) || 0} failed</li>
        ))}
      </ul>
    </div>
  )
}
