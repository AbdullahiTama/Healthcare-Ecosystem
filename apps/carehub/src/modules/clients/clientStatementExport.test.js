import { describe, it, expect } from 'vitest'
import { buildClientLedger, clientStatement } from './clientLedger'
import { buildClientStatementHtml, buildClientStatementXlsx, positionLine, periodText } from './clientStatementExport'

const ledger = buildClientLedger({
  sales: [{ id: 's1', txn_no: 'TXN-1', created_at: '2026-10-01T09:00:00', total: 10000, amount_paid: 4000, balance: 6000, items: '[]' }],
  salePayments: [{ id: 'p1', sale_id: 's1', kind: 'sale', method: 'Cash', amount: 4000, received_at: '2026-10-01T09:00:01Z' }],
  debts: [{ id: 'd1', direction: 'owes_us', source: 'manual', source_ref: 'opening_balance', amount: 1000, created_at: '2026-09-30' }],
})
const who = { business: { name: 'Pharm Tama', address: '1 Broad St', phone: '0800' }, client: { full_name: 'Ada <Obi>', phone: '0801' }, generatedAt: '2026-11-16T10:00:00Z' }

describe('client statement exports', () => {
  it('words the position and the period', () => {
    expect(positionLine(7000)).toBe('Client owes us ₦7,000.00')
    expect(positionLine(-50)).toBe('We owe client ₦50.00')
    expect(positionLine(0)).toBe('Settled')
    expect(periodText({ from: '', to: '' })).toBe('All dates')
    expect(periodText({ from: '2026-10-01', to: '' })).toBe('2026-10-01 to today')
  })

  it('detailed HTML has the header, summary, every entry with running balance, and escapes text', () => {
    const st = clientStatement(ledger, { from: '2026-10-01', to: '2026-10-31' })
    const html = buildClientStatementHtml(st, { ...who, view: 'detailed' })
    expect(html).toContain('Detailed Account Statement')
    expect(html).toContain('Ada &lt;Obi&gt;')
    expect(html).not.toContain('Ada <Obi>')
    expect(html).toContain('Period: 2026-10-01 to 2026-10-31')
    expect(html).toContain('Opening balance brought forward</td><td class="n">1,000.00')
    expect(html).toContain('TXN-1')
    expect(html).toContain('Closing balance carried forward</td><td class="n">7,000.00')
    expect(html).toContain('Client owes us ₦7,000.00')
  })

  it('summary HTML has no transaction table', () => {
    const html = buildClientStatementHtml(clientStatement(ledger), { ...who, view: 'summary' })
    expect(html).toContain('Summary Account Statement')
    expect(html).not.toContain('<h2>Transactions</h2>')
  })

  it('Excel has the summary sheet and, for the detailed view, the transactions with balances', async () => {
    const ExcelJS = (await import('exceljs')).default
    const st = clientStatement(ledger)
    const blob = await buildClientStatementXlsx(st, { ...who, view: 'detailed' })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Transactions'])
    const tx = wb.getWorksheet('Transactions')
    const rows = []
    tx.eachRow((r) => rows.push(r.values.slice(1)))
    expect(rows[0]).toEqual(['Date', 'Reference', 'Description', 'Debit (NGN)', 'Credit (NGN)', 'Balance (NGN)'])
    expect(rows.at(-1).at(-1)).toBe(7000)
    expect(rows.length).toBe(1 + 1 + 3 + 1)
    const summary = await buildClientStatementXlsx(st, { ...who, view: 'summary' })
    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.load(await summary.arrayBuffer())
    expect(wb2.worksheets.map((w) => w.name)).toEqual(['Summary'])
  })
})
