// Excel (.xlsx) export of the Inventory product list. The first ten columns
// follow the bulk-import template order (see csvImport.js); the rest are
// read-only extras. Pure builders — the component only triggers the download.

import { SALE_TYPE_LABELS, unitLabel } from '@care-ecosystem/shared-marketplace'
import { neutraliseFormula, downloadBlob } from '../business-directory/services/exportService'
import { isStockItem, stockStatus } from './inventoryStats'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MONEY_FMT = '#,##0.00'

export const INVENTORY_EXPORT_COLUMNS = [
  { key: 'name', header: 'Product Name', width: 32 },
  { key: 'generic_name', header: 'Generic Name', width: 26 },
  { key: 'category', header: 'Category', width: 16 },
  { key: 'price', header: 'Selling Price (NGN)', width: 18, numFmt: MONEY_FMT },
  { key: 'cost_price', header: 'Cost Price (NGN)', width: 18, numFmt: MONEY_FMT },
  { key: 'stock', header: 'Stock Quantity', width: 15 },
  { key: 'reorder_level', header: 'Reorder Level', width: 14 },
  { key: 'barcode', header: 'Barcode', width: 18 },
  { key: 'list_on_carefind', header: 'List on CareFind (yes/no)', width: 24 },
  { key: 'expiry_date', header: 'Expiry Date', width: 14, numFmt: 'yyyy-mm-dd' },
  { key: 'shelf_label', header: 'Shelf', width: 14 },
  { key: 'sale_type', header: 'Sale Type', width: 14 },
  { key: 'unit', header: 'Unit', width: 12 },
  { key: 'status', header: 'Stock Status', width: 14 },
  { key: 'stock_value', header: 'Stock Value (NGN)', width: 18, numFmt: MONEY_FMT },
  { key: 'cost_value', header: 'Cost Value (NGN)', width: 18, numFmt: MONEY_FMT },
]

// ISO YYYY-MM-DD → a UTC-midnight Date so Excel shows the same calendar day in
// every timezone; anything unparseable exports blank rather than a guess.
function toDateCell(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''))
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}

/** Flatten a product into export cells. Services carry a sentinel stock of 999
 *  and no cost, so their stock and value cells are left blank. */
export function toInventoryExportRow(p) {
  const stockItem = isStockItem(p)
  const stock = stockItem ? (p.stock || 0) : null
  const price = Number(p.price) || 0
  const cost = Number(p.cost_price) || 0
  return {
    name: p.name || '',
    generic_name: p.generic_name || p.genericName || '',
    category: p.cat || p.category || '',
    price,
    cost_price: cost,
    stock,
    reorder_level: stockItem ? (p.reorder_level || 5) : null,
    barcode: p.barcode || '',
    list_on_carefind: p.list_on_carefind === false ? 'no' : 'yes',
    expiry_date: toDateCell(p.expiry_date),
    shelf_label: p.shelf_label || '',
    sale_type: SALE_TYPE_LABELS[p.sale_type] || p.sale_type || '',
    unit: p.price_unit ? unitLabel(p.price_unit) : '',
    status: stockStatus(p),
    stock_value: stockItem ? price * stock : null,
    cost_value: stockItem ? cost * stock : null,
  }
}

export async function buildInventoryXlsx(products, columns = INVENTORY_EXPORT_COLUMNS) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  wb.created = new Date()
  const ws = wb.addWorksheet('Inventory', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }))
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  products.forEach((p) => {
    const r = toInventoryExportRow(p)
    // Text cells are neutralised so a product named "=HYPERLINK(...)" is data, not a formula.
    ws.addRow(Object.fromEntries(columns.map((c) => [c.key, typeof r[c.key] === 'string' ? neutraliseFormula(r[c.key]) : r[c.key]])))
  })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}

export async function exportInventoryXlsx(products) {
  const stamp = new Date().toISOString().slice(0, 10)
  downloadBlob(await buildInventoryXlsx(products), `CareHub_Inventory_${stamp}.xlsx`)
}
