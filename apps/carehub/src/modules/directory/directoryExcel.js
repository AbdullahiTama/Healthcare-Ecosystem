import { unzipSync } from 'fflate'
import readXlsxFile from 'read-excel-file/browser'

// Reads an .xlsx workbook into the same shape the CSV path produces, so the
// import planner, duplicate review and runner are shared and unchanged:
//
//   { rows: string[][], rowNumbers: number[], sheetName, sheetCount, error }
//
// rows[0] is the header; rowNumbers[i] is the ORIGINAL spreadsheet row of rows[i],
// so "row 14" in an error message is row 14 in Excel even when blank rows were
// skipped. Every cell is converted to text; the planner validates meaning.
//
// This module is loaded on demand (dynamic import) so the spreadsheet code is not
// part of the page until an administrator actually chooses an Excel file.
//
// Limits: .xlsx only (the legacy binary .xls and password-protected workbooks are
// refused with a clear message), the first non-empty sheet is used, and a workbook
// whose declared uncompressed size is unreasonable is refused before it is
// inflated (a small file can decompress to something enormous).

export const MAX_XLSX_BYTES = 2 * 1024 * 1024
export const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
export const MAX_ARCHIVE_FILES = 200

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0] // legacy .xls and encrypted .xlsx
const ZIP_MAGIC = [0x50, 0x4b]             // "PK"

const fail = (error) => ({ rows: [], rowNumbers: [], sheetName: null, sheetCount: 0, error })

// Realm-independent checks (instanceof fails for buffers made in another window or
// worker, which TextEncoder and some test environments produce).
const tag = (v) => Object.prototype.toString.call(v)

async function toBytes(input) {
  if (tag(input) === '[object Uint8Array]') return input
  if (tag(input) === '[object ArrayBuffer]') return new Uint8Array(input)
  if (input && typeof input.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer())
  throw new Error('Unsupported input')
}

const startsWith = (bytes, magic) => magic.every((b, i) => bytes[i] === b)

// Declared sizes only: the filter returns false so nothing is inflated.
function inspectArchive(bytes) {
  let total = 0
  let files = 0
  unzipSync(bytes, { filter: (f) => { total += f.originalSize; files++; return false } })
  return { total, files }
}

export function cellToText(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    // String() never uses exponent form below 1e21, so a phone stored as a number
    // stays 8031234567 (its leading 0 is already gone in Excel, which the phone
    // normaliser tolerates).
    return String(v)
  }
  return String(v).trim()
}

export function sheetsToTable(sheets) {
  const list = Array.isArray(sheets) ? sheets : []
  for (const sheet of list) {
    const rows = []
    const rowNumbers = []
    ;(sheet.data || []).forEach((row, i) => {
      const cells = (row || []).map(cellToText)
      if (cells.some((c) => c !== '')) { rows.push(cells); rowNumbers.push(i + 1) }
    })
    if (rows.length) return { rows, rowNumbers, sheetName: sheet.sheet, sheetCount: list.length, error: null }
  }
  return fail('The workbook has no data in any sheet.')
}

export async function readSpreadsheet(input, { read = readXlsxFile } = {}) {
  let bytes
  try { bytes = await toBytes(input) } catch (e) { return fail('That file could not be read.') }
  if (bytes.length === 0) return fail('The file is empty.')
  if (bytes.length > MAX_XLSX_BYTES) return fail('That workbook is larger than 2 MB. Split it and import in parts.')
  if (startsWith(bytes, OLE_MAGIC)) {
    return fail('This looks like an old .xls file or a password-protected workbook, which cannot be read. Open it in Excel and save as .xlsx (without a password) or as CSV.')
  }
  if (!startsWith(bytes, ZIP_MAGIC)) return fail('That is not an Excel .xlsx workbook. Choose an .xlsx or .csv file.')

  try {
    const { total, files } = inspectArchive(bytes)
    if (total > MAX_UNCOMPRESSED_BYTES || files > MAX_ARCHIVE_FILES) {
      return fail('That workbook expands to an unreasonable size and was not opened.')
    }
  } catch (e) {
    return fail('That file is not a valid Excel workbook.')
  }

  try {
    return sheetsToTable(await read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
  } catch (e) {
    return fail('That file could not be read as an Excel workbook. Check that it is a valid .xlsx file.')
  }
}
