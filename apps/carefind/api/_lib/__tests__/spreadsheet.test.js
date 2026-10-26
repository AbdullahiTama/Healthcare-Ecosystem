import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { readFirstSheetRows, writeSheet, checkZipLimits, cellText, SpreadsheetError } from '../spreadsheet.js'

async function xlsx(rows, { sheets = 1 } = {}) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('First')
  rows.forEach((r) => ws.addRow(r))
  for (let i = 1; i < sheets; i++) wb.addWorksheet('Other' + i).addRow(['ignored'])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('readFirstSheetRows', () => {
  it('reads the first sheet as rows of text, keeping column positions', async () => {
    const buf = await xlsx([['Name', 'Phone', 'State'], ['Emzor', 8031234567, 'Lagos'], ['Fidson', null, 'Ogun']], { sheets: 2 })
    expect(await readFirstSheetRows(buf)).toEqual([
      ['Name', 'Phone', 'State'],
      ['Emzor', '8031234567', 'Lagos'],
      ['Fidson', '', 'Ogun'],
    ])
  })

  it('refuses a file that is not .xlsx (old .xls, CSV, anything else) with a clear message', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(40).fill(0)]) // OLE2 header
    await expect(readFirstSheetRows(xls)).rejects.toMatchObject({ code: 'not_xlsx' })
    await expect(readFirstSheetRows(Buffer.from('name,phone\nA,1\n'))).rejects.toThrow(/Only \.xlsx files are supported/)
  })

  it('refuses a damaged zip', async () => {
    const buf = await xlsx([['a']])
    await expect(readFirstSheetRows(buf.subarray(0, buf.length - 30))).rejects.toBeInstanceOf(SpreadsheetError)
  })
})

describe('checkZipLimits (zip-bomb guard, before any decompression)', () => {
  it('accepts a normal spreadsheet and reports its expanded size', async () => {
    const r = checkZipLimits(await xlsx([['a', 'b'], [1, 2]]))
    expect(r.entries).toBeGreaterThan(0)
    expect(r.uncompressed).toBeGreaterThan(0)
  })

  it('refuses a file whose contents would expand past the limit', async () => {
    const buf = await xlsx([['a', 'b'], [1, 2]])
    expect(() => checkZipLimits(buf, { maxUncompressed: 100 })).toThrow(expect.objectContaining({ code: 'too_large' }))
  })

  it('refuses an archive with too many entries', async () => {
    const buf = await xlsx([['a']])
    expect(() => checkZipLimits(buf, { maxEntries: 1 })).toThrow(expect.objectContaining({ code: 'too_large' }))
  })

  it('refuses a size that lies in the directory (forged 4 GB entry)', async () => {
    const buf = Buffer.from(await xlsx([['a']]))
    // Find the first central-directory entry and forge its uncompressed size.
    const at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    buf.writeUInt32LE(0xfffffff0, at + 24)
    expect(() => checkZipLimits(buf)).toThrow(expect.objectContaining({ code: 'too_large' }))
  })
})

describe('cellText', () => {
  it('flattens exceljs cell objects to text', () => {
    expect(cellText({ richText: [{ text: 'Em' }, { text: 'zor' }] })).toBe('Emzor')
    expect(cellText({ formula: 'A1*2', result: 4 })).toBe('4')
    expect(cellText({ text: 'site', hyperlink: 'https://x' })).toBe('site')
    expect(cellText(new Date('2026-10-26T00:00:00Z'))).toBe('2026-10-26')
    expect(cellText({ error: '#DIV/0!' })).toBe('')
    expect(cellText(0)).toBe('0')
    expect(cellText(null)).toBe('')
  })
})

describe('writeSheet', () => {
  it('writes a header row and data rows that read back the same', async () => {
    const buf = await writeSheet('Businesses', ['Business Name', 'State'], [{ 'Business Name': 'Emzor', State: 'Lagos' }])
    expect(await readFirstSheetRows(buf)).toEqual([['Business Name', 'State'], ['Emzor', 'Lagos']])
  })
})
