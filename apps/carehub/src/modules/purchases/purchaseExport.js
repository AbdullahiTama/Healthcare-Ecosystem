// Export of purchase records to Excel (.xlsx) or CSV. One row per purchase line,
// in the same columns as the bulk-upload template (purchaseImport.js), so an
// export can be corrected and uploaded again; the purchase's totals, balance and
// status follow as read-only columns (the upload ignores them).
// Pure builders: the component loads the purchases and triggers the download.

import { buildCsv, buildXlsx, downloadBlob } from '../business-directory/services/exportService'
import { purchaseLines } from './purchaseInvoice'
import { purchaseStatus } from './SupplierPayments'
import { IMPORT_COLUMNS, IMPORT_SHEET } from './purchaseImport'

const MONEY_FMT = '#,##0.00'
const MONEY_KEYS = new Set(['cost', 'sell', 'amountPaid', 'lineTotal', 'purchaseTotal', 'balance'])

export const PURCHASE_EXPORT_COLUMNS = [
  ...IMPORT_COLUMNS.map(c => ({ key: c.key, header: c.header })),
  { key: 'lineTotal', header: 'Line Total (NGN)' },
  { key: 'purchaseTotal', header: 'Purchase Total (NGN)' },
  { key: 'balance', header: 'Balance (NGN)' },
  { key: 'status', header: 'Status' },
  { key: 'recordedOn', header: 'Recorded On' },
].map(c => ({ ...c, width: Math.max(12, c.header.length + 4), ...(MONEY_KEYS.has(c.key) ? { numFmt: MONEY_FMT } : {}) }))

// The reference that groups an exported purchase's lines on re-upload.
export const purchaseRef = (p) => 'P-' + String(p?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase()

const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : '')
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** A purchase (with its `items`) → one export row per line. Purchase-level values are on every row. */
export function purchaseExportRows(p) {
  const { lines } = purchaseLines(p)
  const head = {
    ref: purchaseRef(p),
    supplier: p.supplier_name || '',
    supplyDate: day(p.supply_date) || day(p.created_at),
    amountPaid: num(p.amount_paid),
    dueDate: day(p.due_date),
    notes: p.notes || '',
    purchaseTotal: num(p.total_cost),
    balance: Math.max(0, num(p.balance)),
    status: purchaseStatus(p).label,
    recordedOn: day(p.created_at),
  }
  return lines.map(l => ({
    ...head,
    name: l.name || '',
    qty: num(l.qty),
    cost: num(l.cost),
    sell: l.sell != null ? num(l.sell) : '',
    batch: l.batch || '',
    expiry: day(l.expiry),
    barcode: l.barcode || '',
    cat: l.cat || '',
    lineTotal: num(l.total),
  }))
}

export const toPurchaseExportRows = (purchases) => (purchases || []).flatMap(purchaseExportRows)

/**
 * Builds the file, gives the caller one chance to veto (beforeDownload returns
 * false: the export audit refused), then saves it. Resolves to true when saved.
 */
export async function exportPurchases(format, purchases, { beforeDownload } = {}) {
  const rows = toPurchaseExportRows(purchases)
  const stamp = new Date().toISOString().slice(0, 10)
  // Both builders neutralise text cells that a spreadsheet would run as a formula.
  const content = format === 'csv'
    ? buildCsv(rows, PURCHASE_EXPORT_COLUMNS)
    : await buildXlsx(rows, PURCHASE_EXPORT_COLUMNS, { sheetName: IMPORT_SHEET })
  if (beforeDownload && (await beforeDownload(rows.length)) === false) return false
  if (format === 'csv') downloadBlob(content, `CareHub_Purchases_${stamp}.csv`, 'text/csv;charset=utf-8')
  else downloadBlob(content, `CareHub_Purchases_${stamp}.xlsx`)
  return true
}
