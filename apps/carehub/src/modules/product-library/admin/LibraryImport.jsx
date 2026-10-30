import { useMemo, useRef, useState } from 'react'
import { FileUp, CheckCircle2 } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, GhostBtn, TealBtn, RedBtn } from '../../../components/ui'
import { readSheetRows } from '../../../lib/spreadsheet'
import { libraryRepository } from '../repositories'
import { IMPORT_FIELDS, guessMapping, rowsFromSheet, chunk, addImportResult, emptyImportResult, libraryError } from '../libraryRules'

const { navy, gray500, gray600, border, tealDeep, tealMist, danger } = theme
const th = { padding: '6px 8px', borderBottom: `1px solid ${border}`, textAlign: 'left', fontSize: '11.5px', color: gray500, whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', borderBottom: `1px solid ${border}`, fontSize: '12px', color: navy, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

// Imports an official product list (NAFDAC) into the library, whatever its columns (CareHub admins). The admin checks
// which column holds what, sees the first rows, then imports in batches of 500. Rows are matched to the library by
// NAFDAC number, then by name and strength: a match gains the row's details and is approved; anything else is added,
// approved. Nothing is written before Import is pressed.
export default function LibraryImport({ repository = libraryRepository, onChanged }) {
  const [file, setFile] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [mapping, setMapping] = useState({})
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null) // { done, total }
  const [result, setResult] = useState(null)
  const cancelRef = useRef(false)
  const inputRef = useRef(null)

  const headers = sheet?.[0] || []
  const prepared = useMemo(() => {
    if (!sheet) return null
    try { return rowsFromSheet(sheet, mapping) } catch (e) { return { error: e.message } }
  }, [sheet, mapping])
  const hasName = Object.values(mapping).includes('brand_name')

  async function choose(f) {
    setError(''); setResult(null); setSheet(null); setFile(f || null)
    if (!f) return
    setReading(true)
    try {
      const rows = await readSheetRows(f)
      const first = rows.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''))
      if (first < 0) throw new Error('The file is empty.')
      const s = rows.slice(first)
      setSheet(s)
      setMapping(guessMapping(s[0]))
    } catch (e) { console.error('[library] read file:', e); setError(e.message || 'We could not read that file.') }
    setReading(false)
  }

  function setColumn(i, key) {
    setMapping((m) => {
      const next = { ...m }
      for (const k of Object.keys(next)) if (key && next[k] === key) delete next[k]
      if (key) next[i] = key; else delete next[i]
      return next
    })
  }

  async function runImport() {
    const rows = prepared?.rows || []
    const batches = chunk(rows)
    cancelRef.current = false
    setProgress({ done: 0, total: rows.length })
    let total = emptyImportResult()
    let offset = 0
    try {
      for (const batch of batches) {
        if (cancelRef.current) break
        total = addImportResult(total, await repository.importRows(batch), offset)
        offset += batch.length
        setProgress({ done: offset, total: rows.length })
      }
      setResult({ ...total, stopped: cancelRef.current && offset < rows.length, processed: offset })
      onChanged?.()
    } catch (e) {
      console.error('[library] import:', e)
      setResult({ ...total, processed: offset, failed: libraryError(e, 'The import stopped because of a connection or server problem.') })
    }
    setProgress(null)
  }

  function reset() { setFile(null); setSheet(null); setMapping({}); setResult(null); setError(''); if (inputRef.current) inputRef.current.value = '' }

  if (result) {
    return (
      <Card style={{ padding: 20 }}>
        <div role='status' style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: navy, fontSize: '15px' }}>
            <CheckCircle2 size={18} aria-hidden='true' style={{ color: result.failed ? danger : tealDeep }} />
            {result.failed ? 'Import stopped' : result.stopped ? 'Import cancelled' : 'Import finished'}
          </div>
          {result.failed && <div role='alert' style={{ color: danger, fontSize: '13px' }}>{result.failed} Rows up to {result.processed.toLocaleString()} were saved; import the file again to continue (rows already imported are matched, not duplicated).</div>}
          <div style={{ fontSize: '13px', color: gray600 }}>
            {result.inserted.toLocaleString()} added · {result.updated.toLocaleString()} matched and updated · {result.skipped.toLocaleString()} skipped
          </div>
          {result.errors.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '13px', color: navy, fontWeight: 600 }}>Skipped rows ({result.errors.length}{result.errors.length >= 200 ? '+' : ''})</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '12.5px', color: gray600, maxHeight: 200, overflowY: 'auto' }}>
                {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
              </ul>
            </details>
          )}
          <div><TealBtn onClick={reset} style={{ padding: '9px 14px', fontSize: '12.5px' }}>Import another file</TealBtn></div>
        </div>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FileUp size={22} aria-hidden='true' style={{ color: tealDeep }} />
          <div style={{ flex: '1 1 240px', fontSize: '13px', color: gray600 }}>
            Import an official list such as the NAFDAC register, as <strong>.xlsx</strong> or <strong>.csv</strong> (up to 15 MB). The first row must be the column headings. Imported items are approved.
          </div>
          <label style={{ display: 'inline-flex' }}>
            <span className='sr-only' style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Choose a file to import</span>
            <input ref={inputRef} type='file' accept='.xlsx,.csv,.txt' onChange={(e) => choose(e.target.files?.[0])} disabled={reading || !!progress}
              style={{ fontSize: '13px', maxWidth: 260 }} />
          </label>
        </div>
        {reading && <div role='status' style={{ marginTop: 10, fontSize: '13px', color: gray500 }}>Reading {file?.name}…</div>}
        {error && <div role='alert' style={{ marginTop: 10, fontSize: '13px', color: danger }}>{error}</div>}
      </Card>

      {sheet && prepared && (
        <Card style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', color: navy }}>Which column holds what?</h3>
          <p style={{ margin: '0 0 12px', fontSize: '12.5px', color: gray600 }}>We matched the headings we recognised. Choose “Ignore” for columns you do not need. Product name is required.</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <caption style={{ textAlign: 'left', fontSize: '12px', color: gray500, marginBottom: 6 }}>{file?.name} · first 5 of {Math.max(0, sheet.length - 1).toLocaleString()} rows</caption>
              <thead>
                <tr>{headers.map((h, i) => (
                  <th key={i} scope='col' style={th}>
                    <div style={{ marginBottom: 4 }}>{String(h || `Column ${i + 1}`)}</div>
                    <select value={mapping[i] || ''} onChange={(e) => setColumn(i, e.target.value)} aria-label={`Column ${String(h || i + 1)} holds`}
                      style={{ padding: '6px', borderRadius: theme.radius.sm, border: `1px solid ${mapping[i] ? tealDeep : border}`, background: mapping[i] ? tealMist : 'white', fontSize: '12px', minHeight: 32 }}>
                      <option value=''>Ignore</option>
                      {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {sheet.slice(1, 6).map((r, ri) => <tr key={ri}>{headers.map((_, i) => <td key={i} style={{ ...td, color: mapping[i] ? navy : gray500 }}>{String(r[i] ?? '')}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {prepared.error && <div role='alert' style={{ marginTop: 10, fontSize: '13px', color: danger }}>{prepared.error}</div>}
          {!hasName && <div role='alert' style={{ marginTop: 10, fontSize: '13px', color: danger }}>Choose the column that holds the product name.</div>}
          {hasName && prepared.rows && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, fontSize: '13px', color: gray600 }}>
                {prepared.rows.length.toLocaleString()} rows to import{prepared.missingName ? `; ${prepared.missingName.toLocaleString()} without a name will be skipped` : ''}.
              </span>
              {progress ? (
                <>
                  <span role='status' style={{ fontSize: '13px', color: tealDeep, fontWeight: 700 }}>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</span>
                  <progress value={progress.done} max={progress.total} aria-label='Import progress' style={{ width: 160 }} />
                  <RedBtn onClick={() => { cancelRef.current = true }}>Stop</RedBtn>
                </>
              ) : (
                <>
                  <GhostBtn onClick={reset}>Choose another file</GhostBtn>
                  <TealBtn onClick={runImport} disabled={!prepared.rows.length} style={{ padding: '9px 14px', fontSize: '12.5px' }}>Import {prepared.rows.length.toLocaleString()} rows</TealBtn>
                </>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
