// Retail and wholesale prices on purchase lines (docs/architecture/Wholesale-and-Retail-Prices.md): both optional, on
// the form, the upload template, the recorded purchase, its export, and the products a purchase creates or restocks.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../repositories', () => ({ purchaseRepository: {} }))
vi.mock('../../inventory/repositories', () => ({ productRepository: {} }))
vi.mock('../../debts/repositories', () => ({ debtRepository: {} }))

import { buildImportPlan, readPurchaseTable, buildTemplateCsv, IMPORT_COLUMNS } from '../purchaseImport'
import { recordPurchase } from '../recordPurchase'
import { purchaseLines, purchaseItemsFromForm } from '../purchaseInvoice'
import { purchaseExportRows } from '../purchaseExport'
import { applyProduct, blankItem, isBlankItem } from '../lineItems'
import { parseCsv } from '../../business-directory/services/importService'

const inventory = [
  { id: 'P1', name: 'Paracetamol', price: 80, wholesale_price: 65, cost_price: 40, stock: 5, category: 'Medicines' },
  { id: 'P2', name: 'Zinc', price: 300, wholesale_price: null, cost_price: 150, stock: 5, category: 'Medicines' },
]

const repos = () => {
  const created = []
  return {
    created,
    purchaseRepository: { create: vi.fn(async () => [{ id: 'PUR1' }]) },
    productRepository: {
      update: vi.fn(async (id, _b, u) => ({ id, ...u })),
      create: vi.fn(async (_b, row) => { created.push(row); return [{ id: 'NEW' + created.length, ...row }] }),
      receiveStock: vi.fn(async () => ({ stock: 10 })),
    },
    debtRepository: { recordUnderpayment: vi.fn(async () => ({})) },
  }
}
const line = (o) => ({ ...blankItem(), qty: '10', cost: '100', ...o })
const record = (items, opts = {}) => {
  const r = repos()
  return recordPurchase({ businessId: 'B1', form: { supplier: 'Emzor', supplyDate: '2026-11-25', amountPaid: '100000', items }, inventory, repos: r, ...opts }).then(out => ({ out, r }))
}

describe('lines', () => {
  it('a line with only a wholesale price is not blank', () => {
    expect(isBlankItem(blankItem())).toBe(true)
    expect(isBlankItem({ ...blankItem(), wholesale: '50' })).toBe(false)
  })

  it('picking a product brings in both of its prices', () => {
    expect(applyProduct(blankItem(), inventory[0])).toMatchObject({ sell: '80', wholesale: '65' })
    expect(applyProduct(blankItem(), inventory[1])).toMatchObject({ sell: '300', wholesale: '' })
  })
})

describe('new products', () => {
  it('are created with the prices entered: retail only, wholesale only, or both', async () => {
    const { r, out } = await record([
      line({ name: 'Retail Only', sell: '150' }),
      line({ name: 'Wholesale Only', wholesale: '130' }),
      line({ name: 'Both Prices', sell: '150', wholesale: '130' }),
    ])
    expect(r.created.map(p => [p.name, p.price, p.wholesale_price])).toEqual([
      ['Retail Only', 150, null],
      ['Wholesale Only', 0, 130],
      ['Both Prices', 150, 130],
    ])
    expect(out.newProductsAutoPriced).toBe(false)
  })

  it('get the automatic retail markup only when neither price was entered (as before)', async () => {
    const { r, out } = await record([line({ name: 'No Prices' })])
    expect(r.created[0]).toMatchObject({ price: 150, wholesale_price: null })
    expect(out.newProductsAutoPriced).toBe(true)
  })
})

describe('existing products', () => {
  it('a role that may reprice changes only the prices entered on the line', async () => {
    const { r } = await record([line({ productId: 'P2', name: 'Zinc', sell: '', wholesale: '260' })], { canReprice: true })
    expect(r.productRepository.update).toHaveBeenCalledWith('P2', 'B1', { cost_price: 100, wholesale_price: 260 })
  })

  it('a role that may not reprice changes no price', async () => {
    const { r } = await record([line({ productId: 'P1', name: 'Paracetamol', sell: '99', wholesale: '70' })], { canReprice: false })
    expect(r.productRepository.update).toHaveBeenCalledWith('P1', 'B1', { cost_price: 100 })
  })

  it('an unchanged wholesale price is not written again', async () => {
    const { r } = await record([line({ productId: 'P1', name: 'Paracetamol', sell: '80', wholesale: '65' })], { canReprice: true })
    expect(r.productRepository.update).toHaveBeenCalledWith('P1', 'B1', { cost_price: 100 })
  })
})

describe('the purchase record, invoice and export', () => {
  const stored = { items: purchaseItemsFromForm([line({ id: 'l1', name: 'Both', sell: '150', wholesale: '130' }), line({ id: 'l2', name: 'Neither' })]) }

  it('keeps each line\'s retail and wholesale price (null when not entered)', () => {
    expect(stored.items.map(i => [i.sell, i.wholesale])).toEqual([[150, 130], [null, null]])
    expect(purchaseLines(stored).lines.map(l => [l.sell, l.wholesale])).toEqual([[150, 130], [null, null]])
  })

  it('exports both prices in their own columns, blank when not entered', () => {
    const rows = purchaseExportRows({ id: 'abc', supplier_name: 'Emzor', ...stored })
    expect(rows.map(r => [r.sell, r.wholesale])).toEqual([[150, 130], ['', '']])
  })
})

describe('upload template', () => {
  const HEAD = ['Supplier', 'Supply Date', 'Product Name', 'Quantity', 'Unit Cost (NGN)', 'Retail Price (NGN)', 'Wholesale Price (NGN)']
  const plan = (rows, extra = {}) => buildImportPlan(readPurchaseTable([HEAD, ...rows]).rows, { inventory, today: '2026-11-25', ...extra })

  it('has separate optional Retail Price and Wholesale Price columns', () => {
    const cols = IMPORT_COLUMNS.filter(c => c.key === 'sell' || c.key === 'wholesale')
    expect(cols.map(c => [c.header, c.required])).toEqual([['Retail Price (NGN)', false], ['Wholesale Price (NGN)', false]])
    const [header] = parseCsv(buildTemplateCsv())
    expect(header.indexOf('Wholesale Price (NGN)')).toBe(header.indexOf('Retail Price (NGN)') + 1)
  })

  it('accepts either price, both, or neither', () => {
    const p = plan([
      ['Emzor', '2026-11-25', 'A', '1', '10', '20', ''],
      ['Emzor', '2026-11-25', 'B', '1', '10', '', '18'],
      ['Emzor', '2026-11-25', 'C', '1', '10', '20', '18'],
      ['Emzor', '2026-11-25', 'D', '1', '10', '', ''],
    ])
    expect(p.purchases[0].errors).toEqual([])
    expect(p.purchases[0].form.items.map(i => [i.sell, i.wholesale])).toEqual([['20', ''], ['', '18'], ['20', '18'], ['', '']])
  })

  it('refuses a wholesale price that is not an amount', () => {
    const p = plan([['Emzor', '2026-11-25', 'A', '1', '10', '', 'cheap']])
    expect(p.purchases[0].errors.join(' ')).toMatch(/Wholesale price "cheap" is not a valid amount/)
  })

  it('announces a wholesale price it will set or change, only for a role that may reprice', () => {
    const rows = [['Emzor', '2026-11-25', 'Zinc', '1', '10', '', '260'], ['Emzor', '2026-11-25', 'Paracetamol', '1', '10', '', '70']]
    expect(plan(rows).purchases[0].warnings).toEqual([])
    expect(plan(rows, { canReprice: true }).purchases[0].warnings).toEqual([
      'Row 2: the wholesale price of Zinc will be set to 260.',
      'Row 3: the wholesale price of Paracetamol will change from 65 to 70.',
    ])
  })

  it('still reads files made from the earlier template ("Selling Price" is the retail price)', () => {
    const rows = readPurchaseTable([['Supplier', 'Supply Date', 'Product Name', 'Quantity', 'Unit Cost (NGN)', 'Selling Price (NGN)'], ['Emzor', '2026-11-25', 'A', '1', '10', '20']]).rows
    expect(buildImportPlan(rows, { inventory, today: '2026-11-25' }).purchases[0].form.items[0]).toMatchObject({ sell: '20', wholesale: '' })
  })
})
