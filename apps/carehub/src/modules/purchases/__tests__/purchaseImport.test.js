// Purchases bulk upload: reading the table, every row check, grouping rows into purchases, duplicates and
// recording one purchase after another (purchaseImport.js). Pure: no React, no network.
import { describe, it, expect, vi } from 'vitest'
import {
  parseImportDate, parseImportNumber, readPurchaseTable, buildImportPlan, commitImportPlan, duplicateKey,
  planDateRange, buildTemplateCsv, IMPORT_COLUMNS, MAX_IMPORT_ROWS,
} from '../purchaseImport'
import { parseCsv } from '../../business-directory/services/importService'

const HEAD = ['Purchase Ref', 'Supplier', 'Supply Date', 'Product Name', 'Quantity', 'Unit Cost (NGN)', 'Selling Price (NGN)', 'Batch No.', 'Expiry Date', 'Barcode', 'Category', 'Amount Paid (NGN)', 'Due Date', 'Notes']
const row = (o) => HEAD.map((h) => o[h] ?? '')
const table = (...rows) => readPurchaseTable([HEAD, ...rows.map(row)]).rows
const inventory = [
  { id: 'P-PARA', name: 'Paracetamol 500mg', price: 80, cost_price: 40, barcode: '6151100000123', category: 'Medicines' },
  { id: 'P-INS', name: 'Insulin Pen', price: 9000, cost_price: 6000, tracking_mode: 'batch_expiry', category: 'Medicines' },
]
const ctx = { inventory, today: '2026-11-10' }

describe('values', () => {
  it('reads ISO, Excel and day-first dates; never guesses a month-first one', () => {
    expect(parseImportDate('2026-11-03')).toBe('2026-11-03')
    expect(parseImportDate('2026-11-03T00:00:00.000Z')).toBe('2026-11-03') // an Excel date cell
    expect(parseImportDate('05/11/2026')).toBe('2026-11-05') // 5 November
    expect(parseImportDate('5-11-2026')).toBe('2026-11-05')
    expect(parseImportDate('46329')).toBe('2026-11-03') // Excel serial
    expect(parseImportDate('')).toBe('')
    expect(parseImportDate('31/02/2026')).toBeNull()
    expect(parseImportDate('11/31/2026')).toBeNull()
    expect(parseImportDate('Nov 3')).toBeNull()
  })

  it('reads money with commas and the naira sign', () => {
    expect(parseImportNumber('₦1,250.50')).toBe(1250.5)
    expect(parseImportNumber(' 300 ')).toBe(300)
    expect(parseImportNumber('')).toBe('')
    expect(parseImportNumber('12abc')).toBeNaN()
  })
})

describe('reading the table', () => {
  it('matches headers by name in any order, with common alternatives; reports missing and unused columns', () => {
    const t = readPurchaseTable([['Qty', 'Vendor', 'Item', 'Date', 'Cost Price', 'Colour'], ['3', 'Emzor', 'ORS', '2026-11-01', '50', 'red']])
    expect(t.missing).toEqual([])
    expect(t.ignored).toEqual(['Colour'])
    expect(t.rows).toEqual([{ rowNumber: 2, cells: { qty: '3', supplier: 'Emzor', name: 'ORS', supplyDate: '2026-11-01', cost: '50' } }])
  })

  it('names the required columns a file lacks', () => {
    expect(readPurchaseTable([['Supplier', 'Product'], ['A', 'B']]).missing).toEqual(['Supply Date', 'Quantity', 'Unit Cost (NGN)'])
  })

  it('refuses an empty file, headers without rows, and too many rows', () => {
    expect(() => readPurchaseTable([])).toThrow(/empty/)
    expect(() => readPurchaseTable([HEAD, ['', '']])).toThrow(/no purchase rows/)
    expect(() => readPurchaseTable([HEAD, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ['x'])])).toThrow(/limit is 2,000/)
  })

  it('the template uploads as-is: its two example rows are one ready purchase', () => {
    const t = readPurchaseTable(parseCsv(buildTemplateCsv()))
    expect(t.missing).toEqual([])
    const plan = buildImportPlan(t.rows, ctx)
    expect(plan.summary).toMatchObject({ rows: 2, purchases: 1, ready: 1, withErrors: 0 })
    expect(t.rows[0].cells).toHaveProperty('ref', 'INV-1042')
    expect(Object.keys(t.rows[0].cells)).toHaveLength(IMPORT_COLUMNS.length)
  })
})

describe('grouping rows into purchases', () => {
  it('rows with one ref are one purchase; purchase-level values are given once', () => {
    const plan = buildImportPlan(table(
      { 'Purchase Ref': 'INV-1', Supplier: 'Emzor', 'Supply Date': '2026-11-03', 'Product Name': 'Paracetamol 500mg', Quantity: '100', 'Unit Cost (NGN)': '45', 'Amount Paid (NGN)': '2000', 'Due Date': '30/11/2026' },
      { 'Purchase Ref': 'INV-1', Supplier: 'Emzor', 'Supply Date': '2026-11-03', 'Product Name': 'Vitamin C', Quantity: '10', 'Unit Cost (NGN)': '100' },
    ), ctx)
    expect(plan.purchases).toHaveLength(1)
    const p = plan.purchases[0]
    expect(p.errors).toEqual([])
    expect(p.total).toBe(5500)
    expect(p.form).toMatchObject({ supplier: 'Emzor', supplyDate: '2026-11-03', amountPaid: '2000', dueDate: '2026-11-30', notes: 'Ref INV-1' })
    // An existing product is linked by exact name; a new name is a new product.
    expect(p.form.items.map((i) => [i.name, i.productId])).toEqual([['Paracetamol 500mg', 'P-PARA'], ['Vitamin C', null]])
    expect(p.newProducts).toEqual(['Vitamin C'])
    expect(new Set(p.form.items.map((i) => i.id)).size).toBe(2) // each line its own stock-receipt key
  })

  it('without a ref, rows with the same supplier (any case) and date are one purchase; another date is another', () => {
    const plan = buildImportPlan(table(
      { Supplier: 'Emzor', 'Supply Date': '2026-11-03', 'Product Name': 'A', Quantity: '1', 'Unit Cost (NGN)': '10' },
      { Supplier: ' emzor ', 'Supply Date': '03/11/2026', 'Product Name': 'B', Quantity: '1', 'Unit Cost (NGN)': '10' },
      { Supplier: 'Emzor', 'Supply Date': '2026-11-04', 'Product Name': 'C', Quantity: '1', 'Unit Cost (NGN)': '10' },
    ), ctx)
    expect(plan.purchases.map((p) => p.rowNumbers)).toEqual([[2, 3], [4]])
  })

  it('a ref with two suppliers or dates, or two different amounts paid, is an error naming the rows', () => {
    const plan = buildImportPlan(table(
      { 'Purchase Ref': 'X', Supplier: 'Emzor', 'Supply Date': '2026-11-03', 'Product Name': 'A', Quantity: '1', 'Unit Cost (NGN)': '10', 'Amount Paid (NGN)': '5' },
      { 'Purchase Ref': 'X', Supplier: 'Fidson', 'Supply Date': '2026-11-04', 'Product Name': 'B', Quantity: '1', 'Unit Cost (NGN)': '10', 'Amount Paid (NGN)': '6' },
    ), ctx)
    expect(plan.purchases[0].errors).toEqual([
      'Row 3: Purchase Ref X has a different supplier on another row (Emzor).',
      'Row 3: Purchase Ref X has a different supply date on another row (2026-11-03).',
      'Row 3: Amount Paid (NGN) differs from another row of the same purchase (5 and 6). Fill it in once, or the same on every row.',
    ])
  })
})

describe('row checks (the same rules as the Record Purchase form)', () => {
  const one = (o) => buildImportPlan(table({ Supplier: 'Emzor', 'Supply Date': '2026-11-03', 'Product Name': 'Vitamin C', Quantity: '1', 'Unit Cost (NGN)': '10', ...o }), ctx).purchases[0]

  it('missing or unreadable required values', () => {
    expect(one({ Supplier: '' }).errors).toContain('Row 2: Supplier is missing.')
    expect(one({ 'Supply Date': '' }).errors).toContain('Row 2: Supply date is missing.')
    expect(one({ 'Supply Date': 'yesterday' }).errors[0]).toMatch(/Supply date "yesterday" is not a date/)
    expect(one({ 'Supply Date': '2026-12-01' }).errors).toContain('Row 2: Supply date 2026-12-01 is in the future.')
    expect(one({ 'Product Name': '' }).errors).toContain('Row 2: Product name is missing.')
    expect(one({ Quantity: 'ten' }).errors).toEqual(['Row 2: Quantity "ten" is not a number.'])
    expect(one({ Quantity: '1.5' }).errors).toEqual(['Row 2: Quantity: Whole number above 0.'])
    expect(one({ 'Unit Cost (NGN)': '0' }).errors).toEqual(['Row 2: Unit Cost (NGN): Enter the unit cost.'])
  })

  it('a product tracked by batch and expiry needs both', () => {
    expect(one({ 'Product Name': 'insulin pen' }).errors).toEqual(['Row 2: Batch No.: Batch number needed.', 'Row 2: Expiry Date: Expiry date needed.'])
    expect(one({ 'Product Name': 'Insulin Pen', 'Batch No.': 'B1', 'Expiry Date': '2027-01-31' }).errors).toEqual([])
  })

  it('a barcode belonging to another product is refused', () => {
    expect(one({ Barcode: '6151100000123' }).errors).toEqual(['Row 2: Barcode: Belongs to Paracetamol 500mg.'])
  })

  it('paying more than the total is refused; a past expiry or due date before supply is only a warning', () => {
    expect(one({ 'Amount Paid (NGN)': '11' }).errors).toEqual(['Amount paid (11) is more than the purchase total (10).'])
    const p = one({ 'Expiry Date': '2026-01-01', 'Due Date': '2026-11-01' })
    expect(p.errors).toEqual([])
    expect(p.warnings).toEqual(['Row 2: Vitamin C expired on 2026-01-01.', 'Due date 2026-11-01 is before the supply date.'])
  })

  it('an unknown category becomes Other, with a warning', () => {
    const p = one({ Category: 'Snacks' })
    expect(p.form.items[0].cat).toBe('Other')
    expect(p.warnings[0]).toMatch(/category "Snacks" is not one of/)
  })

  it('an expired plan cannot create products: those purchases need fixing, restocks do not', () => {
    const plan = buildImportPlan(table(
      { Supplier: 'A', 'Supply Date': '2026-11-03', 'Product Name': 'Vitamin C', Quantity: '1', 'Unit Cost (NGN)': '10' },
      { Supplier: 'B', 'Supply Date': '2026-11-03', 'Product Name': 'Paracetamol 500mg', Quantity: '1', 'Unit Cost (NGN)': '10' },
    ), { ...ctx, restricted: true })
    expect(plan.purchases[0].errors[0]).toMatch(/plan has expired.*Vitamin C/)
    expect(plan.purchases[1].errors).toEqual([])
  })

  it('a selling price that would change an existing product is announced only when the role may reprice', () => {
    const o = { 'Product Name': 'Paracetamol 500mg', 'Selling Price (NGN)': '95' }
    expect(one(o).warnings).toEqual([])
    const p = buildImportPlan(table({ Supplier: 'Emzor', 'Supply Date': '2026-11-03', Quantity: '1', 'Unit Cost (NGN)': '10', ...o }), { ...ctx, canReprice: true }).purchases[0]
    expect(p.warnings).toEqual(['Row 2: the selling price of Paracetamol 500mg will change from 80 to 95.'])
  })
})

describe('purchases already recorded', () => {
  it('a purchase with the same supplier, date and total is flagged and counted', () => {
    const rows = table({ Supplier: 'Emzor', 'Supply Date': '2026-11-03', 'Product Name': 'A', Quantity: '2', 'Unit Cost (NGN)': '10' })
    const plan = buildImportPlan(rows, { ...ctx, existingKeys: new Set([duplicateKey('EMZOR ', '2026-11-03', 20)]) })
    expect(plan.purchases[0].duplicate).toBe(true)
    expect(plan.summary.duplicates).toBe(1)
    expect(planDateRange(plan.purchases)).toEqual({ from: '2026-11-03', to: '2026-11-03' })
  })
})

describe('recording', () => {
  const plan = () => buildImportPlan(table(
    { Supplier: 'A', 'Supply Date': '2026-11-03', 'Product Name': 'Vitamin C', Quantity: '1', 'Unit Cost (NGN)': '10' },
    { Supplier: 'B', 'Supply Date': '2026-11-03', 'Product Name': 'vitamin c', Quantity: '1', 'Unit Cost (NGN)': '10' },
    { Supplier: 'C', 'Supply Date': '2026-11-03', 'Product Name': 'Zinc', Quantity: '1', 'Unit Cost (NGN)': '10' },
  ), ctx).purchases

  it('records one after another; a product created by one purchase is restocked by the next, not created twice', async () => {
    const record = vi.fn(async (form) => (form.items[0].productId ? { changedRows: [] } : { changedRows: [{ id: 'NEW-' + form.items[0].name, name: form.items[0].name }] }))
    const progress = vi.fn()
    const r = await commitImportPlan(plan(), { inventory, record, mergeProducts: (list, rows) => [...list, ...rows], onProgress: progress })
    expect(r.recorded).toHaveLength(3)
    expect(record.mock.calls.map(([f]) => f.items[0].productId)).toEqual([null, 'NEW-Vitamin C', null])
    expect(record.mock.calls[1][1].map((p) => p.id)).toContain('NEW-Vitamin C')
    expect(progress).toHaveBeenLastCalledWith(3, 3)
  })

  it('a failed purchase is reported and the rest are still recorded; stopping stops before the next', async () => {
    const record = vi.fn().mockRejectedValueOnce(new Error('Supabase error (500): boom')).mockResolvedValue({ changedRows: [] })
    const r = await commitImportPlan(plan(), { inventory, record })
    expect(r.failed.map((f) => [f.purchase.form.supplier, f.message])).toEqual([['A', 'boom']])
    expect(r.recorded).toHaveLength(2)

    let stop = false
    const r2 = await commitImportPlan(plan(), { inventory, record: vi.fn(async () => { stop = true; return {} }), shouldCancel: () => stop })
    expect(r2.recorded).toHaveLength(1)
  })
})
