import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildSalesReportXlsx, buildSalesReportHtml } from './salesReportExport'

const summary = {
  totalSales: 105000, discounts: 200, transactions: 3, outstanding: 30000, credit: { count: 1, amount: 30000 },
  received: { total: 79000, Cash: 3500, Transfer: 71500, POS: 4000, Unspecified: 0 }, collections: 4000,
  refunds: { total: 500, Cash: 500, Transfer: 0, POS: 0, Unspecified: 0 }, netReceived: 78500, cashInHand: 3000, estimated: false,
}
const rows = [
  { saleId: 's1', receipt: 'TXN-1', date: new Date('2026-10-21T10:00:00Z'), customer: '=HYPERLINK("http://x")', products: 'Amoxil ×10', quantity: 10,
    total: 100000, discount: 0, paid: 70000, outstanding: 30000, refunded: 0, method: 'Credit', status: 'Part-paid', cashier: 'Rep One', shift: 'No shift' },
  { saleId: 's2', receipt: 'TXN-2', date: new Date('2026-10-21T11:00:00Z'), customer: '<script>alert(1)</script>', products: 'Panadol ×3', quantity: 3,
    total: 3000, discount: 200, paid: 3000, outstanding: 0, refunded: 500, method: 'Cash', status: 'Paid', cashier: 'Rep Two', shift: 'No shift' },
]
const meta = { businessName: 'Ada Pharmacy', periodLabel: 'Today', filtersLabel: 'Cashier: Rep One', generatedBy: 'Rep One', generatedAt: new Date('2026-10-21T15:00:00Z') }

describe('buildSalesReportXlsx', () => {
  it('writes a Summary sheet and a Transactions sheet with every row', async () => {
    const blob = await buildSalesReportXlsx({ rows, summary, meta })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Transactions'])
    const tx = wb.getWorksheet('Transactions')
    expect(tx.getRow(1).values).toContain('Receipt')
    expect(tx.rowCount).toBe(3)
    expect(tx.getRow(2).getCell(2).value).toBe('TXN-1')
    const summaryText = JSON.stringify(wb.getWorksheet('Summary').getSheetValues())
    expect(summaryText).toContain('Total sales')
    expect(summaryText).toContain('105000')
    expect(summaryText).toContain('Ada Pharmacy')
  })

  it('neutralises formula-looking text so a customer name is data, not a formula', async () => {
    const blob = await buildSalesReportXlsx({ rows, summary, meta })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const cells = []
    wb.getWorksheet('Transactions').eachRow((r) => r.eachCell((c) => cells.push(c.value)))
    expect(cells).toContain('\'=HYPERLINK("http://x")')
    expect(cells.some((v) => v && typeof v === 'object' && 'formula' in v)).toBe(false)
  })

  it('carries no cost or profit column', async () => {
    const blob = await buildSalesReportXlsx({ rows, summary, meta })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const headers = wb.getWorksheet('Transactions').getRow(1).values.join('|')
    expect(headers).not.toMatch(/cost|profit|margin/i)
  })
})

describe('buildSalesReportHtml', () => {
  const html = buildSalesReportHtml({ rows, summary, meta })
  it('escapes everything that came from the database', () => {
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
  it('states the business, period, filters, who printed it and the summary', () => {
    for (const s of ['Ada Pharmacy', 'Today', 'Cashier: Rep One', 'Total sales', 'Net received', 'Outstanding', 'Refunds', 'TXN-1', 'TXN-2']) {
      expect(html).toContain(s)
    }
  })
  it('flags estimated money figures', () => {
    expect(buildSalesReportHtml({ rows, summary: { ...summary, estimated: true }, meta })).toMatch(/estimated/i)
  })
  it('has an explicit empty state', () => {
    expect(buildSalesReportHtml({ rows: [], summary, meta })).toContain('No sales match')
  })
  it('carries no cost or profit wording in what is printed', () => {
    const printed = html.replace(/<style>[\s\S]*?<\/style>/, '')
    expect(printed).not.toMatch(/\b(cost|profit|margin)\b/i)
  })
})
