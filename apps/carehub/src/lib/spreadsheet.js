// ── Spreadsheet reading ───────────────────────────────────────────────────────
// Reads a .csv / .txt or .xlsx file in the browser into rows of strings. Shared
// by the importers (business directory, product library). Legacy .xls and other
// types are refused before anything is read, as are files over the size limit.

export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024

// CSV text -> rows. Handles a BOM, quoted fields with commas, quotes and line
// breaks, and a comma, semicolon or tab delimiter (whichever the header uses most).
export function parseCsv(text) {
  let s = String(text ?? '')
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const firstLine = s.split(/\r?\n/, 1)[0] || ''
  const stripped = firstLine.replace(/"[^"]*"/g, '')
  const counts = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of stripped) if (ch in counts) counts[ch]++
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"' && field === '') inQuotes = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// An ExcelJS cell value as text (rich text, formulas, hyperlinks, dates).
export function cellText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString()
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if ('result' in v) return cellText(v.result)
    if ('text' in v) return cellText(v.text)
    if ('hyperlink' in v) return String(v.hyperlink)
    return ''
  }
  return String(v)
}

/**
 * File/Blob -> array of rows (strings).
 * @param opts.maxBytes     size limit (default 15 MB)
 * @param opts.sheet        preferred worksheet name in a workbook (else the first sheet)
 * @param opts.minColumns   read at least this many cells per row (keeps empty trailing columns)
 * @param opts.unsupported  message for an unsupported file type
 */
export async function readSheetRows(file, { maxBytes = DEFAULT_MAX_BYTES, sheet = null, minColumns = 0, unsupported = 'Unsupported file type. Upload a .xlsx or .csv file.' } = {}) {
  if (!file) throw new Error('Choose a file first.')
  if (file.size > maxBytes) throw new Error('This file is larger than ' + maxBytes / 1024 / 1024 + ' MB. Split it into smaller files.')
  const name = String(file.name || '').toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text())
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const ws = (sheet && wb.getWorksheet(sheet)) || wb.worksheets[0]
    if (!ws) throw new Error('The workbook has no sheets.')
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = []
      const n = Math.max(row.cellCount, minColumns)
      for (let c = 1; c <= n; c++) cells.push(cellText(row.getCell(c).value))
      rows.push(cells)
    })
    return rows
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel choose Save As → Excel Workbook (.xlsx) or CSV.')
  throw new Error(unsupported)
}
