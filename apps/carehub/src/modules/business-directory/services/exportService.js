// ── BusinessExportService ─────────────────────────────────────────────────────
// CSV, Excel, JSON and PDF (browser print-to-PDF, matching the project's other
// document.write print templates) for directory rows / discovery results.

import { esc } from '../../../lib/escape'
import { formatDistance } from './distance'

export const EXPORT_COLUMNS = [
  { key: 'name', header: 'Business Name' },
  { key: 'category', header: 'Category' },
  { key: 'subcategory', header: 'Subcategory' },
  { key: 'address', header: 'Address' },
  { key: 'state', header: 'State' },
  { key: 'lga', header: 'LGA' },
  { key: 'city', header: 'City/Town' },
  { key: 'phone', header: 'Phone' },
  { key: 'email', header: 'Email' },
  { key: 'website', header: 'Website' },
  { key: 'distance', header: 'Distance (km)' },
  { key: 'latitude', header: 'Latitude' },
  { key: 'longitude', header: 'Longitude' },
  { key: 'verification', header: 'Verification' },
  { key: 'source', header: 'Data Source' },
]

/** Flatten a directory row (+ optional distance) into export cells. */
export function toExportRow(r, categoryName, subcategoryName) {
  return {
    name: r.name,
    category: categoryName || '',
    subcategory: subcategoryName || '',
    address: r.address || '',
    state: r.state || '',
    lga: r.lga || '',
    city: r.city || '',
    phone: r.phone || '',
    email: r.email || '',
    website: r.website || '',
    distance: r.distance_km == null ? '' : Number(r.distance_km.toFixed(2)),
    latitude: r.latitude ?? '',
    longitude: r.longitude ?? '',
    verification: r.verification_status || '',
    source: r.origin === 'platform' ? 'Platform registry' : r.data_source === 'demo' ? 'DEMO DATA' : (r.data_source || ''),
  }
}

// Spreadsheet formula injection: a text cell beginning with = @ TAB or CR is
// executed by Excel; + and - too unless the value is a plain number/phone.
export function neutraliseFormula(v) {
  if (typeof v !== 'string' || v === '') return v
  if (/^[=@\t\r]/.test(v)) return "'" + v
  if (/^[+-]/.test(v) && !/^[+-]?[\d\s().-]+$/.test(v)) return "'" + v
  return v
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(neutraliseFormula(typeof v === 'number' ? v : String(v)))
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildCsv(rows, columns = EXPORT_COLUMNS) {
  const head = columns.map((c) => csvCell(c.header)).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))
  return '﻿' + [head, ...body].join('\r\n') + '\r\n'
}

export function buildJson(rows) {
  return JSON.stringify({ exported_at: new Date().toISOString(), count: rows.length, businesses: rows }, null, 2)
}

export async function buildXlsx(rows, columns = EXPORT_COLUMNS) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet('Businesses')
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }))
  ws.getRow(1).font = { bold: true }
  rows.forEach((r) => {
    const o = {}
    columns.forEach((c) => { o[c.key] = typeof r[c.key] === 'string' ? neutraliseFormula(r[c.key]) : r[c.key] })
    ws.addRow(o)
  })
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function buildPrintHtml(rows, { title = 'Business Directory Export', subtitle = '' } = {}) {
  const cols = ['name', 'category', 'address', 'phone', 'email', 'website', 'distance', 'verification']
  const heads = { name: 'Business', category: 'Category', address: 'Address', phone: 'Phone', email: 'Email', website: 'Website', distance: 'Distance', verification: 'Status' }
  const cell = (r, k) => (k === 'distance' ? esc(r.distance === '' ? '' : formatDistance(Number(r.distance))) : esc(r[k]))
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;color:#182722;margin:24px}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 12px;color:#5B6B63}' +
    'table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6d3c8;padding:5px 6px;text-align:left;vertical-align:top}th{background:#E3EEE8}' +
    '</style></head><body><h1>' + esc(title) + '</h1><p>' + esc(subtitle) + ' · ' + rows.length + ' record(s) · ' + esc(new Date().toLocaleString('en-NG')) + '</p>' +
    '<table><thead><tr>' + cols.map((k) => '<th>' + heads[k] + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + cols.map((k) => '<td>' + cell(r, k) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></body></html>'
}

/** Trigger a browser download for a string or Blob. */
export function downloadBlob(content, fileName, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Open the print dialog (user picks "Save as PDF"). */
export function printAsPdf(html) {
  const w = window.open('', '_blank')
  if (!w) throw new Error('Pop-up blocked. Allow pop-ups for this site to export PDF.')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
}

export async function exportRows(format, rows, { baseName = 'businesses', title, subtitle, columns = EXPORT_COLUMNS } = {}) {
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'csv') downloadBlob(buildCsv(rows, columns), `${baseName}-${stamp}.csv`, 'text/csv;charset=utf-8')
  else if (format === 'json') downloadBlob(buildJson(rows), `${baseName}-${stamp}.json`, 'application/json')
  else if (format === 'xlsx') downloadBlob(await buildXlsx(rows, columns), `${baseName}-${stamp}.xlsx`)
  else if (format === 'pdf') printAsPdf(buildPrintHtml(rows, { title, subtitle }))
  else throw new Error('Unknown export format: ' + format)
}
