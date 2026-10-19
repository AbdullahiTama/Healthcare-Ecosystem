import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { makeXlsx } from '../../test/makeXlsx.js'
import { readSpreadsheet, cellToText, sheetsToTable, MAX_XLSX_BYTES } from './directoryExcel.js'
import { parseCsv, autoMapColumns, buildImportPlan, fileFingerprint, defaultDecisions, selectRowsToImport, ROW_STATUS } from './directoryImport.js'

const CATS = [{ id: 'c-ph', slug: 'pharmacy', name: 'Pharmacies', parent_id: null }]
const book = (rows, name = 'Sheet1') => makeXlsx([{ name, rows }])

describe('readSpreadsheet: real workbooks', () => {
  it('reads a header and data rows, converting every cell to text', async () => {
    const out = await readSpreadsheet(book({
      1: ['Business Name', 'Category', 'Phone', 'Latitude', 'Longitude', 'Open'],
      2: ['  Alpha Pharmacy  ', 'pharmacy', 8031234567, 6.6018, 3.3515, true],
    }))
    expect(out.error).toBeNull()
    expect(out.rows[0]).toEqual(['Business Name', 'Category', 'Phone', 'Latitude', 'Longitude', 'Open'])
    expect(out.rows[1]).toEqual(['Alpha Pharmacy', 'pharmacy', '8031234567', '6.6018', '3.3515', 'true'])
    expect(out.sheetName).toBe('Sheet1')
  })

  it('keeps original spreadsheet row numbers when blank rows are skipped', async () => {
    const out = await readSpreadsheet(book({ 1: ['name'], 2: ['A'], 4: ['B'], 7: ['C'] }))
    expect(out.rows.map((r) => r[0])).toEqual(['name', 'A', 'B', 'C'])
    expect(out.rowNumbers).toEqual([1, 2, 4, 7])
  })

  it('handles a header that does not start on row 1', async () => {
    const out = await readSpreadsheet(book({ 3: ['name'], 4: ['A'] }))
    expect(out.rows.map((r) => r[0])).toEqual(['name', 'A'])
    expect(out.rowNumbers).toEqual([3, 4])
  })

  it('uses the first sheet that has data and says how many there were', async () => {
    const out = await readSpreadsheet(makeXlsx([
      { name: 'Empty', rows: {} },
      { name: 'Directory', rows: { 1: ['name'], 2: ['A'] } },
      { name: 'Other', rows: { 1: ['x'], 2: ['y'] } },
    ]))
    expect(out).toMatchObject({ sheetName: 'Directory', sheetCount: 3, error: null })
  })

  it('reports a workbook with no data', async () => {
    expect((await readSpreadsheet(makeXlsx([{ name: 'Empty', rows: {} }]))).error).toMatch(/no data/)
  })

  it('accepts an ArrayBuffer as well as bytes', async () => {
    const bytes = book({ 1: ['name'], 2: ['A'] })
    const out = await readSpreadsheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(out.error).toBeNull()
  })
})

describe('readSpreadsheet: refusals', () => {
  it('refuses an old .xls or password-protected workbook (OLE container) with a way forward', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
    const out = await readSpreadsheet(ole)
    expect(out.error).toMatch(/old \.xls|password/i)
    expect(out.error).toMatch(/save as \.xlsx/)
    expect(out.rows).toEqual([])
  })
  it('refuses a file that is not a workbook', async () => {
    expect((await readSpreadsheet(strToU8('name,phone\nA,1\n'))).error).toMatch(/not an Excel/)
  })
  it('refuses an empty file', async () => {
    expect((await readSpreadsheet(new Uint8Array(0))).error).toMatch(/empty/)
  })
  it('refuses an oversize workbook before parsing it', async () => {
    const big = new Uint8Array(MAX_XLSX_BYTES + 1); big[0] = 0x50; big[1] = 0x4b
    const out = await readSpreadsheet(big, { read: () => { throw new Error('must not be parsed') } })
    expect(out.error).toMatch(/larger than 2 MB/)
  })
  it('refuses a corrupt zip', async () => {
    const out = await readSpreadsheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    expect(out.error).toMatch(/not a valid Excel workbook/)
  })
  it('refuses a small archive that would expand to an unreasonable size, without inflating it', async () => {
    const bomb = zipSync({ 'xl/big.xml': new Uint8Array(70 * 1024 * 1024) }, { level: 9 })
    expect(bomb.length).toBeLessThan(MAX_XLSX_BYTES)
    const out = await readSpreadsheet(bomb, { read: () => { throw new Error('must not be parsed') } })
    expect(out.error).toMatch(/unreasonable size/)
  })
  it('refuses an archive with an excessive number of entries', async () => {
    const many = {}
    for (let i = 0; i < 250; i++) many['f' + i + '.txt'] = new Uint8Array(1)
    const out = await readSpreadsheet(zipSync(many), { read: () => { throw new Error('must not be parsed') } })
    expect(out.error).toMatch(/unreasonable size/)
  })
  it('turns a valid zip that is not a workbook into a friendly error, never a crash', async () => {
    const out = await readSpreadsheet(zipSync({ 'hello.txt': strToU8('hi') }))
    expect(out.error).toMatch(/could not be read as an Excel workbook/)
  })
})

describe('cellToText / sheetsToTable', () => {
  it('converts every cell type to text', () => {
    expect([null, undefined, '  x ', 42, 6.5, true, false, NaN, new Date('2026-10-19T10:00:00Z')].map(cellToText))
      .toEqual(['', '', 'x', '42', '6.5', 'true', 'false', '', '2026-10-19'])
  })
  it('drops fully blank rows but keeps their numbering', () => {
    const t = sheetsToTable([{ sheet: 'S', data: [['name'], [null, null], ['A']] }])
    expect(t.rows).toEqual([['name'], ['A']])
    expect(t.rowNumbers).toEqual([1, 3])
  })
})

describe('Excel through the shared import planner', () => {
  const plan = async (rows, fp = 'fp') => {
    const t = await readSpreadsheet(book(rows))
    const { mapping } = autoMapColumns(t.rows[0])
    return buildImportPlan(t.rows, { mapping, categories: CATS, existing: [], fingerprint: fp, rowNumbers: t.rowNumbers })
  }

  it('reports errors against the ORIGINAL Excel row, even after blank rows', async () => {
    const p = await plan({
      1: ['name', 'category', 'state', 'latitude', 'longitude'],
      2: ['Good One', 'pharmacy', 'Lagos', 6.5, 3.4],
      5: ['Bad Geo', 'pharmacy', 'Lagos', 95, 3],
      9: ['', 'pharmacy', 'Lagos', 6, 3],
    })
    expect(p.rows.map((r) => [r.row, r.status])).toEqual([[2, ROW_STATUS.NEW], [5, ROW_STATUS.INVALID], [9, ROW_STATUS.INVALID]])
    expect(p.rows[1].errors.latitude).toBeTruthy()
  })

  it('numeric phone and coordinate cells validate like text ones', async () => {
    const p = await plan({ 1: ['name', 'category', 'phone', 'state', 'latitude', 'longitude'], 2: ['A', 'pharmacy', 8031234567, 'Lagos', 6.5, 3.4] })
    expect(p.rows[0].status).toBe(ROW_STATUS.NEW)
    expect(p.rows[0].record).toMatchObject({ phone: '8031234567', latitude: 6.5, longitude: 3.4 })
  })

  it('the same workbook gives the same source references, so a re-import cannot duplicate', async () => {
    const bytes = book({ 1: ['name', 'state'], 2: ['A', 'Lagos'], 3: ['B', 'Lagos'] })
    const fp = fileFingerprint(bytes)
    expect(fileFingerprint(bytes)).toBe(fp)
    const t = await readSpreadsheet(bytes)
    const { mapping } = autoMapColumns(t.rows[0])
    const a = buildImportPlan(t.rows, { mapping, categories: [], fingerprint: fp, rowNumbers: t.rowNumbers })
    const b = buildImportPlan(t.rows, { mapping, categories: [], fingerprint: fp, rowNumbers: t.rowNumbers })
    expect(a.rows.map((r) => r.record.source_ref)).toEqual([fp + ':2', fp + ':3'])
    expect(b.rows.map((r) => r.record.source_ref)).toEqual(a.rows.map((r) => r.record.source_ref))
    expect(fileFingerprint(book({ 1: ['name'], 2: ['C'] }))).not.toBe(fp)
  })

  it('an Excel import never sets verification and always records the import source', async () => {
    const p = await plan({ 1: ['name', 'state', 'verification_status'], 2: ['A', 'Lagos', 'verified'] })
    expect(p.rows[0].record).not.toHaveProperty('verification_status')
    expect(p.rows[0].record.data_source).toBe('import')
    expect(selectRowsToImport(p.rows, defaultDecisions(p.rows))).toHaveLength(p.rows.filter((r) => r.status === ROW_STATUS.NEW).length)
  })
})

describe('CSV row numbers (shared fix)', () => {
  it('counts blank lines and quoted newlines so "row N" matches the file', () => {
    const { rows, rowNumbers } = parseCsv('name\r\nA\r\n\r\n"B\nline2"\r\nC\r\n')
    expect(rows.map((r) => r[0])).toEqual(['name', 'A', 'B\nline2', 'C'])
    expect(rowNumbers).toEqual([1, 2, 4, 5])
  })
  it('plans CSV errors against those numbers', () => {
    const { rows, rowNumbers } = parseCsv('name,latitude,longitude\nA,6,3\n\n\nBad,99,3\n')
    const { mapping } = autoMapColumns(rows[0])
    const p = buildImportPlan(rows, { mapping, categories: [], rowNumbers })
    expect(p.rows.map((r) => r.row)).toEqual([2, 5])
    expect(p.rows[1].status).toBe(ROW_STATUS.INVALID)
  })
})
