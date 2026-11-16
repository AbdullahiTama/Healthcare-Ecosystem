// An export the database audits before the file is saved (record_export_audit): build the file, ask for the audit
// record, save the file unless the database refused this person, and say what happened. Shared by the Debts,
// Supplier accounts and Credit accounts exports (Purchases' export follows the same steps in purchaseExport.js).
//
// Resolves to true when the file was saved. Never throws: failures are shown with `showToast` and logged.
import { buildCsv, buildXlsx, downloadBlob } from '../modules/business-directory/services/exportService'
import { auditRepository } from '../modules/audit/repositories'

export async function auditedExport({
  format, rows, columns, sheetName, fileBase, businessId, exportType, filters = {}, noun = 'record', showToast,
  logTag = '[export]', audit = auditRepository, save = downloadBlob,
}) {
  const n = rows.length + ' ' + noun + (rows.length === 1 ? '' : 's')
  if (!rows.length) { showToast?.(`There are no ${noun}s to export.`, { type: 'warning' }); return false }
  try {
    // Both builders neutralise text cells that a spreadsheet would run as a formula.
    const content = format === 'csv' ? buildCsv(rows, columns) : await buildXlsx(rows, columns, { sheetName })
    const result = await audit.recordExport(businessId, { exportType: `${exportType}.${format}`, rowCount: rows.length, filters })
    if (result.status === 'refused') {
      showToast?.('Your role is not allowed to export data.', { type: 'error' })
      return false
    }
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') save(content, `${fileBase}_${stamp}.csv`, 'text/csv;charset=utf-8')
    else save(content, `${fileBase}_${stamp}.xlsx`)
    if (result.status !== 'recorded') {
      console.warn(logTag, 'export audit record not saved:', result.status)
      showToast?.(`Exported ${n}, but the audit record could not be saved.`, { type: 'warning' })
    } else {
      console.info(logTag, 'exported', { rows: rows.length, format })
      showToast?.(`Exported ${n}.`, { type: 'success' })
    }
    return true
  } catch (e) {
    console.error(logTag, 'export failed:', e)
    showToast?.('Could not export: ' + (e?.message || 'unknown error'), { type: 'error' })
    return false
  }
}

const MONEY_FMT = '#,##0.00'
// Column definitions with a sensible width, and money formatting for the keys listed.
export function exportColumns(defs, moneyKeys = []) {
  const money = new Set(moneyKeys)
  return defs.map((c) => ({ ...c, width: c.width || Math.max(12, c.header.length + 4), ...(money.has(c.key) ? { numFmt: MONEY_FMT } : {}) }))
}
