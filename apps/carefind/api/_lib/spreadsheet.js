// Spreadsheet reading and writing for the API, on exceljs.
//
// Replaces xlsx@0.18.5 (SheetJS), which has two unfixed HIGH advisories on npm
// (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9) and was
// parsing files uploaded to the server. CareHub already uses exceljs for the
// same directory import.
//
// Only .xlsx (Office Open XML) is read. An .xlsx file is a zip archive, so
// before anything is decompressed the zip's own directory is checked: a small
// upload whose contents expand to gigabytes (a "zip bomb") is refused instead
// of exhausting the function's memory. The caller still caps the upload size.
import ExcelJS from 'exceljs'

export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 2000

export class SpreadsheetError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_END_OF_CENTRAL_DIR = 0x06054b50
const ZIP_CENTRAL_ENTRY = 0x02014b50

// Sums the uncompressed sizes recorded in the zip's central directory, without
// decompressing. Throws SpreadsheetError for anything that is not a plain zip
// within limits (ZIP64 archives are refused: no real directory spreadsheet
// needs one, and their sizes would need a second parser).
export function checkZipLimits(buf, { maxUncompressed = MAX_UNCOMPRESSED_BYTES, maxEntries = MAX_ZIP_ENTRIES } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== ZIP_LOCAL_HEADER) {
    throw new SpreadsheetError('not_xlsx', 'Only .xlsx files are supported. In Excel, use File > Save As > Excel Workbook (.xlsx).')
  }
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIR) { eocd = i; break }
  }
  if (eocd === -1) throw new SpreadsheetError('bad_zip', 'The file is damaged or is not a valid .xlsx file.')
  const entries = buf.readUInt16LE(eocd + 10)
  const dirOffset = buf.readUInt32LE(eocd + 16)
  if (entries === 0xffff || dirOffset === 0xffffffff) throw new SpreadsheetError('bad_zip', 'The file is too large or is not a valid .xlsx file.')
  if (entries > maxEntries) throw new SpreadsheetError('too_large', 'The spreadsheet is too large to import.')

  let p = dirOffset
  let total = 0
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ZIP_CENTRAL_ENTRY) {
      throw new SpreadsheetError('bad_zip', 'The file is damaged or is not a valid .xlsx file.')
    }
    const uncompressed = buf.readUInt32LE(p + 24)
    if (uncompressed === 0xffffffff) throw new SpreadsheetError('too_large', 'The spreadsheet is too large to import.')
    total += uncompressed
    if (total > maxUncompressed) throw new SpreadsheetError('too_large', 'The spreadsheet is too large to import.')
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return { entries, uncompressed: total }
}

// A cell value as plain text: exceljs returns rich text, formulas, hyperlinks
// and dates as objects.
export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().split('T')[0]
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text || '').join('')
    if ('result' in value) return cellText(value.result)
    if ('text' in value) return cellText(value.text)
    if ('error' in value) return ''
    return ''
  }
  return String(value)
}

// The first worksheet as an array of rows, each an array of cell text, with
// column positions preserved (empty cells are '').
export async function readFirstSheetRows(buf) {
  checkZipLimits(buf)
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf)
  } catch (e) {
    throw new SpreadsheetError('bad_xlsx', 'The file could not be read as an .xlsx spreadsheet.')
  }
  const ws = wb.worksheets[0]
  if (!ws) return []
  const rows = []
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = []
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value))
    rows[rowNumber - 1] = cells
  })
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  return rows
}

// An .xlsx buffer with one sheet: a header row from `columns` (labels) and one
// row per object in `rows` (keyed by label). Column widths follow the content.
export async function writeSheet(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  ws.columns = columns.map((label) => ({
    header: label,
    key: label,
    width: Math.max(label.length, ...rows.map((r) => String(r[label] ?? '').length)) + 2,
  }))
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
