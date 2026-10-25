import { describe, it, expect } from 'vitest'
import { buildInventoryXlsx, toInventoryExportRow, INVENTORY_EXPORT_COLUMNS } from './inventoryExport'

const med = { name: 'Amoxicillin 500mg', generic_name: 'Amoxicillin', cat: 'Medicines', price: 1500, cost_price: 800, stock: 10, reorder_level: 20, barcode: '0123', list_on_carefind: true, expiry_date: '2027-06-30', sale_type: 'retail', price_unit: 'card', shelf_label: 'A1' }
const service = { name: 'Consultation Fee', category: 'Services', price: 5000, cost_price: 0, stock: 999 }

async function load(products) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await (await buildInventoryXlsx(products)).arrayBuffer())
  return wb.getWorksheet('Inventory')
}

describe('inventory export', () => {
  it('computes status and values for stock items', () => {
    const r = toInventoryExportRow(med)
    expect(r.status).toBe('Low stock')
    expect(r.stock_value).toBe(15000)
    expect(r.cost_value).toBe(8000)
    expect(r.sale_type).toBe('Retail')
    expect(r.unit).toBe('Card')
  })

  it('leaves stock and value blank for services (sentinel stock of 999)', () => {
    const r = toInventoryExportRow(service)
    expect(r.status).toBe('Service')
    expect(r.stock).toBeNull()
    expect(r.stock_value).toBeNull()
  })

  it('writes a header plus one row per product, keeping barcode as text', async () => {
    const ws = await load([med, service])
    expect(ws.rowCount).toBe(3)
    expect(ws.getRow(1).getCell(1).value).toBe('Product Name')
    expect(ws.getRow(2).getCell(8).value).toBe('0123')
    expect(ws.getRow(2).getCell(4).value).toBe(1500)
    expect(ws.getRow(2).getCell(10).value.toISOString().slice(0, 10)).toBe('2027-06-30')
  })

  it('neutralises formula-looking text', async () => {
    const ws = await load([{ ...med, name: '=HYPERLINK("http://x")' }])
    expect(ws.getRow(2).getCell(1).value).toBe("'=HYPERLINK(\"http://x\")")
  })

  it('exports an empty list as a header-only sheet', async () => {
    const ws = await load([])
    expect(ws.rowCount).toBe(1)
    expect(ws.getRow(1).cellCount).toBe(INVENTORY_EXPORT_COLUMNS.length)
  })
})
