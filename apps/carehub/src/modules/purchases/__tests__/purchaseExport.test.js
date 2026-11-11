// Purchases export (purchaseExport.js): one row per line, the upload template's columns first so an export can be
// uploaded again, spreadsheet formulas neutralised, and the audit veto respected.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../business-directory/services/exportService', async (orig) => ({ ...(await orig()), downloadBlob: vi.fn() }))
import { downloadBlob } from '../../business-directory/services/exportService'
import { purchaseExportRows, exportPurchases, purchaseRef, PURCHASE_EXPORT_COLUMNS } from '../purchaseExport'
import { readPurchaseTable, buildImportPlan, IMPORT_COLUMNS } from '../purchaseImport'
import { parseCsv } from '../../business-directory/services/importService'

const itemised = {
  id: '1a2b3c4d-0000-4000-8000-000000000001', supplier_name: 'Emzor', supply_date: '2026-11-03', due_date: '2026-11-30', notes: 'Weekly order',
  total_cost: 5500, amount_paid: 2000, balance: 3500, status: 'partial', created_at: '2026-11-03T09:00:00Z',
  items: [
    { id: 'l1', name: 'Paracetamol 500mg', qty: 100, cost: 45, sell: 80, batch: 'B1', expiry: '2028-06-30', cat: 'Medicines' },
    { id: 'l2', name: '=HYPERLINK("x")', qty: 10, cost: 100, sell: null, cat: 'Other' },
  ],
}
const legacy = { id: 'p2', supplier_name: 'Old Supplier', product_name: 'Mixed stock', quantity: 4, cost_price: 25, total_cost: 100, amount_paid: 100, balance: 0, status: 'paid', created_at: '2026-01-02T00:00:00Z', items: null }

beforeEach(() => vi.clearAllMocks())

describe('rows', () => {
  it('one row per line, purchase values on each, a ref grouping them', () => {
    const rows = purchaseExportRows(itemised)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ ref: 'P-1A2B3C4D', supplier: 'Emzor', supplyDate: '2026-11-03', name: 'Paracetamol 500mg', qty: 100, cost: 45, sell: 80, batch: 'B1', expiry: '2028-06-30', cat: 'Medicines', amountPaid: 2000, dueDate: '2026-11-30', notes: 'Weekly order', lineTotal: 4500, purchaseTotal: 5500, balance: 3500, status: 'Part paid', recordedOn: '2026-11-03' })
    expect(rows[1]).toMatchObject({ ref: purchaseRef(itemised), sell: '', lineTotal: 1000 })
  })

  it('a purchase from before line items were kept is one summary row, dated by when it was recorded', () => {
    expect(purchaseExportRows(legacy)).toEqual([expect.objectContaining({ name: 'Mixed stock', qty: 4, cost: 25, lineTotal: 100, supplyDate: '2026-01-02', status: 'Paid' })])
  })

  it('the template columns come first, in order', () => {
    expect(PURCHASE_EXPORT_COLUMNS.slice(0, IMPORT_COLUMNS.length).map((c) => c.header)).toEqual(IMPORT_COLUMNS.map((c) => c.header))
  })
})

describe('files', () => {
  it('CSV: formulas neutralised, and the file uploads again as the same purchase', async () => {
    const saved = await exportPurchases('csv', [itemised])
    expect(saved).toBe(true)
    const [csv, name] = downloadBlob.mock.calls[0]
    expect(name).toMatch(/^CareHub_Purchases_\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    const t = readPurchaseTable(parseCsv(csv))
    expect(t.missing).toEqual([])
    expect(t.ignored).toEqual(['Line Total (NGN)', 'Purchase Total (NGN)', 'Balance (NGN)', 'Status', 'Recorded On'])
    const plan = buildImportPlan(t.rows, { inventory: [], today: '2026-11-10' })
    expect(plan.purchases).toHaveLength(1)
    expect(plan.purchases[0]).toMatchObject({ total: 5500, paid: 2000, errors: [] })
    expect(plan.purchases[0].form).toMatchObject({ dueDate: '2026-11-30', notes: 'Weekly order' })
  })

  it('Excel: a Purchases sheet with the rows', async () => {
    await exportPurchases('xlsx', [itemised, legacy])
    const blob = downloadBlob.mock.calls[0][0]
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.getWorksheet('Purchases')
    expect(ws.rowCount).toBe(4)
    expect(ws.getRow(1).getCell(1).value).toBe('Purchase Ref')
    expect(ws.getRow(3).getCell(4).value).toBe("'=HYPERLINK(\"x\")")
  })

  it('nothing is saved when the audit refuses; the row count is passed to it', async () => {
    const before = vi.fn(async () => false)
    expect(await exportPurchases('csv', [itemised], { beforeDownload: before })).toBe(false)
    expect(before).toHaveBeenCalledWith(2)
    expect(downloadBlob).not.toHaveBeenCalled()
  })
})
