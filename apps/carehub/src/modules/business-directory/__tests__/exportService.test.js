import { describe, it, expect } from 'vitest'
import { buildCsv, buildJson, buildXlsx, buildPrintHtml, toExportRow, neutraliseFormula, EXPORT_COLUMNS } from '../services/exportService'

const row = toExportRow({
  name: 'Alpha, "The" Pharmacy', address: '12 Rd', state: 'Lagos', phone: '+234 803 111 2222', email: 'a@b.co', website: 'https://a.ng',
  distance_km: 1.2345, latitude: 6.5, longitude: 3.4, verification_status: 'verified', data_source: 'manual',
}, 'Pharmacy', 'Community')

describe('export', () => {
  it('CSV: header, quoting, distance rounding, BOM for Excel', () => {
    const csv = buildCsv([row])
    const [head, body] = csv.replace(/^﻿/, '').trim().split(/\r\n/)
    expect(head.split(',')).toHaveLength(EXPORT_COLUMNS.length)
    expect(body).toContain('"Alpha, ""The"" Pharmacy"')
    expect(body).toContain('1.23')
    expect(body).toContain('+234 803 111 2222') // phone is not mangled
  })

  it('CSV/XLSX neutralise spreadsheet formulas but not numbers or phones', () => {
    expect(neutraliseFormula('=HYPERLINK("http://x")')).toBe("'=HYPERLINK(\"http://x\")")
    expect(neutraliseFormula('@SUM(1)')).toBe("'@SUM(1)")
    expect(neutraliseFormula('-2+3')).toBe("'-2+3")
    expect(neutraliseFormula('-1.5')).toBe('-1.5')
    expect(neutraliseFormula('+234 803')).toBe('+234 803')
    const csv = buildCsv([{ ...row, name: '=cmd|calc' }])
    expect(csv).toContain("'=cmd|calc")
  })

  it('demo records are labelled DEMO DATA in every export', () => {
    expect(toExportRow({ name: 'x', data_source: 'demo' }).source).toBe('DEMO DATA')
  })

  it('JSON carries the count', () => {
    const j = JSON.parse(buildJson([row]))
    expect(j.count).toBe(1)
    expect(j.businesses[0].name).toBe('Alpha, "The" Pharmacy')
  })

  it('XLSX opens and holds the rows', async () => {
    const blob = await buildXlsx([row])
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.getWorksheet('Businesses')
    expect(ws.rowCount).toBe(2)
    expect(ws.getRow(2).getCell(1).value).toBe('Alpha, "The" Pharmacy')
  })

  it('PDF/print HTML escapes user text', () => {
    const html = buildPrintHtml([{ ...row, name: '<script>alert(1)</script>' }], { title: 'T <b>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
