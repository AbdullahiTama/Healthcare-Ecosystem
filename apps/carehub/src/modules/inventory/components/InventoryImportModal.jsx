import { useState, useRef } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { readSheetRows } from '../../../lib/spreadsheet'
import { downloadBlob } from '../../business-directory/services/exportService'
import { readInventoryTable, planInventoryImport, buildInventoryTemplateCsv, INVENTORY_COLUMNS, MAX_INVENTORY_IMPORT_BYTES, MAX_INVENTORY_IMPORT_ROWS } from '../csvImport'
import { saveInBatches, buildRowsToFixCsv } from '../../../lib/spreadsheetImport'
import { productRepository } from '../repositories'
import { theme } from '../../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading } from '../../../components/ui'
import { ImportStats, ImportNotice, UploadDropzone, UploadProgress, RowIssueList, DownloadRowsButton } from '../../../components/BulkUpload'

const { navy, gray600, tealDeep } = theme

// Inventory bulk upload (docs/architecture/Bulk-Uploads-and-Debt-Linking.md).
// choose a file → preview (every row checked, nothing saved) → saving → result.
// Every row in the file is accounted for: imported, duplicate, needs fixing,
// over the plan limit, or not saved with the database's reason. The rows not
// saved can be downloaded, fixed and uploaded again; rows already imported are
// then duplicates, so nothing is added twice.
//
// Props: existing (the loaded catalogue), remaining (products the plan still
// allows), catalogReady, businessId, allow(action) (the plan gate),
// onSaved(rows) (folds the new products into the list).
export default function InventoryImportModal({ show, onClose, existing = [], remaining = Infinity, catalogReady = true, businessId, allow = () => true, onSaved, repository = productRepository }) {
  const [step, setStep] = useState('choose') // choose | reading | preview | saving | done
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [plan, setPlan] = useState(null)
  const [missing, setMissing] = useState([])
  const [ignored, setIgnored] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const cancelRef = useRef(false)
  const busy = step === 'reading' || step === 'saving'

  function reset() {
    setStep('choose'); setError(''); setFileName(''); setPlan(null); setMissing([]); setIgnored([])
    setProgress({ done: 0, total: 0 }); setResult(null); cancelRef.current = false
  }
  function close() { if (busy) return; reset(); onClose() }

  function downloadTemplate() {
    downloadBlob(buildInventoryTemplateCsv(), 'CareHub_Inventory_Template.csv', 'text/csv;charset=utf-8')
  }

  async function onFile(file) {
    setError(''); setFileName(file.name); setStep('reading')
    try {
      const raw = await readSheetRows(file, { sheet: 'Products', minColumns: INVENTORY_COLUMNS.length, maxBytes: MAX_INVENTORY_IMPORT_BYTES, unsupported: 'Unsupported file type. Upload the CareHub template as .xlsx or .csv.' })
      const table = readInventoryTable(raw)
      setMissing(table.missing); setIgnored(table.ignored)
      if (table.missing.length) { setPlan(null); setStep('preview'); return }
      const built = planInventoryImport(table.rows, { existing, remaining })
      console.info('[inventory] import previewed', built.summary)
      setPlan(built)
      setStep('preview')
    } catch (err) {
      console.error('[inventory] import: could not read the file:', err?.message)
      setError(err?.message || 'Could not read the file. Use the CareHub template.')
      setStep('choose')
    }
  }

  const ready = plan ? plan.items.filter(i => i.status === 'ready') : []
  const refused = plan ? plan.items.filter(i => i.status === 'invalid' || i.status === 'over_limit') : []
  const duplicates = plan ? plan.items.filter(i => i.status === 'duplicate') : []

  async function commit() {
    if (!ready.length || busy || !allow('importing products')) return
    cancelRef.current = false
    setStep('saving')
    setProgress({ done: 0, total: ready.length })
    const r = await saveInBatches(ready, {
      toRecord: (item) => item.product,
      createMany: (records) => repository.createMany(businessId, records),
      createOne: (record) => repository.create(businessId, record),
      onProgress: (done, total) => setProgress({ done, total }),
      shouldCancel: () => cancelRef.current,
    })
    const rows = r.saved.map(s => s.row).filter(row => row && row.id != null)
    if (rows.length) onSaved?.(rows)
    const notStarted = ready.length - r.saved.length - r.failed.length
    const summary = {
      submitted: plan.summary.submitted,
      imported: r.saved.length,
      duplicates: duplicates.length,
      failed: refused.length + r.failed.length,
      notStarted,
      failedRows: [...refused.map(i => ({ ...i, problem: i.reason })), ...r.failed.map(f => ({ ...f.item, status: 'failed', reason: f.message, problem: f.message }))].sort((a, b) => a.rowNumber - b.rowNumber),
    }
    console.info('[inventory] import saved', { ...summary, failedRows: summary.failedRows.length })
    setResult(summary)
    setStep('done')
  }

  function downloadRowsToFix(entries) {
    downloadBlob(buildRowsToFixCsv(INVENTORY_COLUMNS, entries.map(e => ({ cells: e.cells, problem: e.problem || e.reason }))), 'CareHub_Inventory_Rows_To_Fix.csv', 'text/csv;charset=utf-8')
  }

  const issueEntries = plan ? plan.items.filter(i => i.status !== 'ready' || i.warnings.length).map(i => ({
    rowNumber: i.rowNumber, title: i.product.name || i.cells.name, status: i.status === 'ready' ? 'warning' : i.status,
    reason: [i.reason, ...i.warnings].filter(Boolean).join(' '),
  })) : []

  const footer = step === 'preview' && plan ? (
    <>
      <GhostBtn onClick={reset} style={{ flex: 1, padding: '12px' }}>Choose another file</GhostBtn>
      <TealBtn onClick={commit} disabled={!ready.length || !catalogReady} style={{ flex: 1, padding: '12px' }}>
        {ready.length ? `Import ${ready.length.toLocaleString()} product${ready.length === 1 ? '' : 's'}` : 'Nothing to import'}
      </TealBtn>
    </>
  ) : step === 'saving' ? (
    <GhostBtn onClick={() => { cancelRef.current = true }} style={{ flex: 1, padding: '12px' }}>Stop after this batch</GhostBtn>
  ) : step === 'done' ? (
    <TealBtn onClick={close} style={{ flex: 1, padding: '12px' }}>Done</TealBtn>
  ) : (
    <GhostBtn onClick={close} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
  )

  return (
    <Modal show={show} onClose={close} title='Upload Products from Excel / CSV' wide preventClose={busy} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {step === 'choose' && (
          <>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6 }}>
              One row per product. Fill in the template in Excel or Google Sheets and upload it as <strong>.xlsx</strong> or <strong>.csv</strong>.
              Set <strong>Expiry Date</strong> as YYYY-MM-DD (for example 2027-06-30), or leave it blank.
              You will see every row before anything is saved. A product whose name or barcode is already in Inventory is skipped, so a corrected file can be uploaded again safely.
              Up to {MAX_INVENTORY_IMPORT_ROWS.toLocaleString()} rows per file.
            </div>
            <div><GhostBtn onClick={downloadTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Download Template</GhostBtn></div>
            {!catalogReady && <div role='status' style={{ fontSize: 12.5, color: theme.warning }}>Your products are still loading. Wait a moment so duplicates can be found.</div>}
            <UploadDropzone accept='.xlsx,.csv,.txt' disabled={!catalogReady} onFile={onFile} ariaLabel='Products file to upload'
              hint={'Required column: Product Name. Other columns: ' + INVENTORY_COLUMNS.slice(1).map(c => c.header).join(', ')} />
            {error && <ImportNotice tone='danger'>{error}</ImportNotice>}
          </>
        )}

        {step === 'reading' && <Loading text={'Reading ' + fileName + '…'} />}

        {step === 'preview' && !plan && missing.length > 0 && (
          <ImportNotice tone='danger'>{fileName} has no <strong>{missing.join(', ')}</strong> column. Use the CareHub template, or rename your header to match it.</ImportNotice>
        )}

        {step === 'preview' && plan && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: navy, fontWeight: 700 }}>
              <FileSpreadsheet size={16} color={tealDeep} aria-hidden='true' /> {fileName}
            </div>
            <ImportStats stats={[
              { label: 'Rows in file', value: plan.summary.submitted.toLocaleString() },
              { label: 'Ready to import', value: plan.summary.ready.toLocaleString(), tone: 'success' },
              { label: 'Duplicates', value: plan.summary.duplicates.toLocaleString(), tone: plan.summary.duplicates ? 'warning' : undefined },
              { label: 'Need fixing', value: plan.summary.invalid.toLocaleString(), tone: plan.summary.invalid ? 'danger' : undefined },
              plan.summary.overLimit ? { label: 'Over plan limit', value: plan.summary.overLimit.toLocaleString(), tone: 'warning' } : null,
            ]} />
            {ignored.length > 0 && <div style={{ fontSize: 12, color: theme.gray500 }}>Columns not used: {ignored.join(', ')}.</div>}
            {plan.summary.overLimit > 0 && <ImportNotice tone='warning'>Your plan allows {remaining.toLocaleString()} more product{remaining === 1 ? '' : 's'}. {plan.summary.overLimit.toLocaleString()} row{plan.summary.overLimit === 1 ? ' is' : 's are'} over the limit and will not be imported. Upgrade to import them.</ImportNotice>}
            {plan.summary.invalid > 0 && <ImportNotice tone='danger'>{plan.summary.invalid.toLocaleString()} row{plan.summary.invalid === 1 ? '' : 's'} cannot be imported until fixed. The others can be imported now; download the rows to fix, correct them and upload that file.</ImportNotice>}
            <RowIssueList entries={issueEntries} label='Rows that need attention' />
            <div><DownloadRowsButton count={refused.length} onClick={() => downloadRowsToFix(refused)} /></div>
          </>
        )}

        {step === 'saving' && <UploadProgress done={progress.done} total={progress.total} noun='products' />}

        {step === 'done' && result && (
          <>
            <ImportNotice tone={result.failed || result.notStarted ? 'warning' : 'success'}>
              <strong>{result.imported.toLocaleString()} of {result.submitted.toLocaleString()} row{result.submitted === 1 ? '' : 's'} imported.</strong>
              {result.duplicates > 0 && ` ${result.duplicates.toLocaleString()} duplicate${result.duplicates === 1 ? '' : 's'} skipped.`}
              {result.failed > 0 && ` ${result.failed.toLocaleString()} not imported (reasons below).`}
              {result.notStarted > 0 && ` ${result.notStarted.toLocaleString()} not started (stopped).`}
            </ImportNotice>
            <ImportStats stats={[
              { label: 'Submitted', value: result.submitted.toLocaleString() },
              { label: 'Imported', value: result.imported.toLocaleString(), tone: 'success' },
              { label: 'Duplicates', value: result.duplicates.toLocaleString(), tone: result.duplicates ? 'warning' : undefined },
              { label: 'Failed', value: result.failed.toLocaleString(), tone: result.failed ? 'danger' : undefined },
            ]} />
            <RowIssueList entries={result.failedRows.map(f => ({ rowNumber: f.rowNumber, title: f.product?.name || f.cells?.name, status: f.status, reason: f.reason }))} label='Rows not imported' />
            <div><DownloadRowsButton count={result.failedRows.length} onClick={() => downloadRowsToFix(result.failedRows)} /></div>
          </>
        )}
      </div>
    </Modal>
  )
}
