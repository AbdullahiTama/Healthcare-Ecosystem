import { useState, useRef } from 'react'
import { Upload, Download, AlertTriangle, CheckCircle, FileSpreadsheet, Copy } from 'lucide-react'
import { readSpreadsheet } from '../../business-directory/services/importService'
import { downloadBlob } from '../../business-directory/services/exportService'
import {
  readPurchaseTable, buildImportPlan, commitImportPlan, planDateRange, buildTemplateCsv, buildTemplateXlsx,
  IMPORT_COLUMNS, IMPORT_SHEET, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS,
} from '../purchaseImport'
import { fmt, todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading, Empty, Pill } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray100, border, danger, dangerBg, warning, warningBg, success } = theme

// Bulk upload of purchases (docs/architecture/Purchases-Import-Export.md).
// Steps: choose a file → preview (every purchase checked; nothing saved) →
// record (one purchase after another, with progress) → result.
//
// The caller owns the data: `record(form, inventory)` records one purchase
// (recordPurchase.js), `loadExistingKeys(range)` returns the duplicateKeys of
// purchases already recorded in that supply-date range, `mergeProducts` folds
// created products into the list, `onDone(result)` refreshes the page.
export default function PurchaseImportModal({ show, onClose, inventory = [], catalogReady = true, restricted = false, canReprice = false, loadExistingKeys, record, mergeProducts, onDone }) {
  const [step, setStep] = useState('choose') // choose | reading | preview | recording | done
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [plan, setPlan] = useState(null)
  const [missing, setMissing] = useState([])
  const [ignored, setIgnored] = useState([])
  const [dupCheck, setDupCheck] = useState('ok') // ok | failed
  const [includeDuplicates, setIncludeDuplicates] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const cancelRef = useRef(false)
  const fileRef = useRef(null)

  const busy = step === 'reading' || step === 'recording'
  function reset() {
    setStep('choose'); setError(''); setFileName(''); setPlan(null); setMissing([]); setIgnored([])
    setDupCheck('ok'); setIncludeDuplicates(false); setProgress({ done: 0, total: 0 }); setResult(null); cancelRef.current = false
  }
  function close() {
    if (busy) return
    reset()
    onClose()
  }

  async function downloadTemplate(format) {
    try {
      if (format === 'csv') downloadBlob(buildTemplateCsv(), 'CareHub_Purchases_Template.csv', 'text/csv;charset=utf-8')
      else downloadBlob(await buildTemplateXlsx(), 'CareHub_Purchases_Template.xlsx')
    } catch (e) {
      console.error('[purchases] template download failed:', e)
      setError('Could not create the template. Please try again.')
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setFileName(file.name); setStep('reading')
    try {
      const raw = await readSpreadsheet(file, { sheetName: IMPORT_SHEET, columnCount: IMPORT_COLUMNS.length, maxBytes: MAX_IMPORT_BYTES })
      const table = readPurchaseTable(raw)
      setMissing(table.missing); setIgnored(table.ignored)
      if (table.missing.length) { setStep('preview'); setPlan(null); return }
      const ctx = { inventory, today: todayDate(), restricted, canReprice }
      let built = buildImportPlan(table.rows, ctx)
      // Compare with purchases already recorded in the file's dates, to catch a file uploaded twice.
      const range = planDateRange(built.purchases)
      if (range && loadExistingKeys) {
        try {
          built = buildImportPlan(table.rows, { ...ctx, existingKeys: await loadExistingKeys(range) })
          setDupCheck('ok')
        } catch (err) {
          console.warn('[purchases] import: could not check for purchases already recorded:', err?.message)
          setDupCheck('failed')
        }
      }
      console.info('[purchases] import previewed', built.summary)
      setPlan(built)
      setStep('preview')
    } catch (err) {
      console.error('[purchases] import: could not read the file:', err?.message)
      setError(err?.message || 'Could not read the file. Use the CareHub template.')
      setStep('choose')
    }
  }

  const ready = plan ? plan.purchases.filter(p => !p.errors.length && (includeDuplicates || !p.duplicate)) : []

  async function commit() {
    if (!ready.length || busy) return
    cancelRef.current = false
    setStep('recording')
    setProgress({ done: 0, total: ready.length })
    const r = await commitImportPlan(ready, {
      inventory, record, mergeProducts,
      shouldCancel: () => cancelRef.current,
      onProgress: (done, total) => setProgress({ done, total }),
    })
    const stockIssues = r.recorded.flatMap(x => x.result?.syncFailed || [])
    const debtIssues = r.recorded.filter(x => x.result?.debtFailed).length
    console.info('[purchases] import recorded', { recorded: r.recorded.length, failed: r.failed.length, cancelled: cancelRef.current, stockIssues: stockIssues.length, debtIssues })
    const summary = { ...r, stockIssues, debtIssues, cancelled: cancelRef.current, notStarted: ready.length - r.recorded.length - r.failed.length }
    setResult(summary)
    setStep('done')
    onDone?.(summary)
  }

  const footer = step === 'preview' && plan ? (
    <>
      <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
      <TealBtn onClick={commit} disabled={!ready.length || !catalogReady} style={{ flex: 1, padding: '12px' }}>
        {ready.length ? `Record ${ready.length} purchase${ready.length === 1 ? '' : 's'}` : 'Nothing to record'}
      </TealBtn>
    </>
  ) : step === 'recording' ? (
    <GhostBtn onClick={() => { cancelRef.current = true }} style={{ flex: 1, padding: '12px' }}>Stop after this purchase</GhostBtn>
  ) : step === 'done' ? (
    <TealBtn onClick={close} style={{ flex: 1, padding: '12px' }}>Done</TealBtn>
  ) : (
    <GhostBtn onClick={close} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
  )

  return (
    <Modal show={show} onClose={close} title='Upload purchases from Excel / CSV' wide preventClose={busy} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {step === 'choose' && (
          <>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>
              One row per product line. Rows with the same <strong>Purchase Ref</strong> (or, without one, the same supplier and supply date) become one purchase.
              Each purchase is recorded like one typed into <strong>Record Purchase</strong>: stock goes into Inventory and any unpaid balance goes to Debts.
              You will see every purchase before anything is saved. Up to {MAX_IMPORT_ROWS.toLocaleString()} rows per file.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <GhostBtn onClick={() => downloadTemplate('xlsx')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Excel template</GhostBtn>
              <GhostBtn onClick={() => downloadTemplate('csv')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> CSV template</GhostBtn>
            </div>
            {!catalogReady && <div role='status' style={{ fontSize: 12.5, color: warning }}>Your products are still loading. Wait a moment so the file's items match your existing products.</div>}
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 16px', borderRadius: theme.radius.lg, position: 'relative', border: `2px dashed ${border}`, cursor: catalogReady ? 'pointer' : 'not-allowed', opacity: catalogReady ? 1 : 0.6, textAlign: 'center' }}>
              <Upload size={28} color={tealDeep} aria-hidden='true' />
              <span style={{ fontWeight: 700, color: navy, fontSize: 14 }}>Choose an .xlsx or .csv file</span>
              <span style={{ fontSize: 12, color: gray500 }}>Required columns: {IMPORT_COLUMNS.filter(c => c.required).map(c => c.header).join(', ')}</span>
              <input ref={fileRef} type='file' accept='.xlsx,.csv,.txt' onChange={onFile} disabled={!catalogReady} aria-label='Purchases file to upload'
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
            </label>
            {error && <Notice tone='danger'>{error}</Notice>}
          </>
        )}

        {step === 'reading' && <Loading text={'Reading ' + fileName + '…'} />}

        {step === 'preview' && !plan && missing.length > 0 && (
          <Notice tone='danger'>
            {fileName} is missing {missing.length === 1 ? 'the column' : 'the columns'} <strong>{missing.join(', ')}</strong>. Use the CareHub template, or rename your headers to match it.
          </Notice>
        )}

        {step === 'preview' && plan && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: navy, fontWeight: 700 }}>
              <FileSpreadsheet size={16} color={tealDeep} aria-hidden='true' /> {fileName}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>
              <Stat label='Rows' value={plan.summary.rows} />
              <Stat label='Ready to record' value={plan.summary.ready - (includeDuplicates ? 0 : plan.summary.duplicates)} tone='success' />
              <Stat label='Need fixing' value={plan.summary.withErrors} tone={plan.summary.withErrors ? 'danger' : undefined} />
              <Stat label='Total (ready)' value={fmt(ready.reduce((s, p) => s + p.total, 0))} />
            </div>
            {ignored.length > 0 && <div style={{ fontSize: 12, color: gray500 }}>Columns not used: {ignored.join(', ')}.</div>}
            {dupCheck === 'failed' && <Notice tone='warning'>Could not check whether these purchases were already recorded. Make sure this file has not been uploaded before.</Notice>}
            {plan.summary.withErrors > 0 && <Notice tone='danger'>{plan.summary.withErrors} purchase{plan.summary.withErrors === 1 ? '' : 's'} cannot be recorded until the rows below are fixed. The others can be recorded now; fix the file and upload just the rest later.</Notice>}
            {plan.summary.duplicates > 0 && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: 12.5, color: navy, cursor: 'pointer' }}>
                <input type='checkbox' checked={includeDuplicates} onChange={e => setIncludeDuplicates(e.target.checked)} style={{ marginTop: 2, accentColor: tealDeep }} />
                <span>{plan.summary.duplicates} purchase{plan.summary.duplicates === 1 ? ' looks' : 's look'} already recorded (same supplier, date and total) and will be <strong>skipped</strong>. Tick to record {plan.summary.duplicates === 1 ? 'it' : 'them'} anyway.</span>
              </label>
            )}
            {plan.purchases.length === 0 ? <Empty message='No purchase rows in this file.' /> : (
              <ul aria-label='Purchases in the file' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {plan.purchases.map(p => <PlanRow key={p.key} p={p} skipped={p.duplicate && !includeDuplicates} />)}
              </ul>
            )}
          </>
        )}

        {step === 'recording' && (
          <div role='status' aria-live='polite' style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: navy }}>Recording purchase {Math.min(progress.done + 1, progress.total)} of {progress.total}…</div>
            <div style={{ height: 8, borderRadius: 4, background: gray100, overflow: 'hidden' }} aria-hidden='true'>
              <div style={{ width: (progress.total ? (progress.done / progress.total) * 100 : 0) + '%', height: '100%', background: tealDeep, transition: 'width 200ms' }} />
            </div>
            <div style={{ fontSize: 12, color: gray500 }}>Keep this page open. Each purchase adds its stock and debt as it is recorded.</div>
          </div>
        )}

        {step === 'done' && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Notice tone={result.failed.length || result.stockIssues.length || result.debtIssues ? 'warning' : 'success'}>
              <strong>{result.recorded.length} purchase{result.recorded.length === 1 ? '' : 's'} recorded</strong>
              {result.failed.length > 0 && `, ${result.failed.length} not recorded`}
              {result.cancelled && result.notStarted > 0 && `, ${result.notStarted} not started (stopped)`}.
            </Notice>
            {result.failed.length > 0 && (
              <div style={{ fontSize: 12.5, color: navy }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Not recorded (nothing was saved for these; upload just these rows again):</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.failed.map(f => <li key={f.purchase.key}>{label(f.purchase)}: {f.message}</li>)}
                </ul>
              </div>
            )}
            {result.stockIssues.length > 0 && <Notice tone='warning'>Recorded, but stock was not added for: {result.stockIssues.join(', ')}. Add it from Inventory.</Notice>}
            {result.debtIssues > 0 && <Notice tone='warning'>{result.debtIssues} recorded purchase{result.debtIssues === 1 ? '' : 's'} with a balance could not be added to Debts. Add {result.debtIssues === 1 ? 'it' : 'them'} in Debts.</Notice>}
          </div>
        )}
      </div>
    </Modal>
  )
}

const label = (p) => (p.ref ? p.ref + ' · ' : '') + (p.form.supplier || 'No supplier') + ', ' + (p.form.supplyDate || 'no date') + ' (row' + (p.rowNumbers.length > 1 ? 's ' : ' ') + p.rowNumbers.join(', ') + ')'

function PlanRow({ p, skipped }) {
  const bad = p.errors.length > 0
  const status = bad ? { label: 'Needs fixing', type: 'red' } : skipped ? { label: 'Skipped: duplicate', type: 'amber' } : { label: 'Ready', type: 'green' }
  return (
    <li style={{ border: `1px solid ${bad ? danger : border}`, borderRadius: theme.radius.md, padding: '10px 12px', background: bad ? dangerBg : 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: navy }}>{p.form.supplier || 'No supplier'}{p.ref ? <span style={{ color: gray500, fontWeight: 600 }}> · {p.ref}</span> : null}</div>
          <div style={{ fontSize: 12, color: gray600 }}>
            {p.form.supplyDate || 'No date'} · {p.form.items.length} item{p.form.items.length === 1 ? '' : 's'} · {fmt(p.total)}
            {p.paid > 0 && ` · paid ${fmt(p.paid)}`}{p.newProducts.length > 0 && ` · ${p.newProducts.length} new product${p.newProducts.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <Pill label={status.label} type={status.type} />
      </div>
      {(p.errors.length > 0 || p.warnings.length > 0) && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
          {p.errors.map((e, i) => <li key={'e' + i} style={{ color: danger }}>{e}</li>)}
          {p.warnings.map((w, i) => <li key={'w' + i} style={{ color: theme.amberText || warning }}>{w}</li>)}
        </ul>
      )}
    </li>
  )
}

function Stat({ label: text, value, tone }) {
  const color = tone === 'danger' ? danger : tone === 'success' ? success : navy
  return (
    <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: tealMist }}>
      <div style={{ fontSize: 11, color: gray500, fontWeight: 600 }}>{text}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function Notice({ tone, children }) {
  const c = tone === 'danger' ? { bg: dangerBg, fg: danger, Icon: AlertTriangle } : tone === 'warning' ? { bg: warningBg, fg: warning, Icon: AlertTriangle } : tone === 'success' ? { bg: tealMist, fg: tealDeep, Icon: CheckCircle } : { bg: tealMist, fg: tealDeep, Icon: Copy }
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: c.bg, border: `1px solid ${c.fg}`, fontSize: 12.5, color: navy, lineHeight: 1.5 }}>
      <c.Icon size={15} color={c.fg} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
      <div>{children}</div>
    </div>
  )
}
