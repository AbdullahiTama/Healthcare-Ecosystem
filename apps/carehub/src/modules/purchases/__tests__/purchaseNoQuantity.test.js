// Uploaded purchase rows without a quantity (owner decision 2026-11-19): the amount is recorded and counted, no stock
// is added, and Edit Purchase can add the quantity later. Before, such a row blocked its whole purchase, which then
// reached neither the Purchases list nor the Purchase Summary.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../repositories', () => ({ purchaseRepository: {} }))
vi.mock('../../inventory/repositories', () => ({ productRepository: {} }))
vi.mock('../../debts/repositories', () => ({ debtRepository: {} }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))

import { buildImportPlan, readPurchaseTable } from '../purchaseImport'
import { recordPurchase, purchaseFigures } from '../recordPurchase'
import { purchaseLines, formFromPurchase, editItemsFromForm, purchaseItemsFromForm } from '../purchaseInvoice'
import { itemProblems } from '../lineItems'
import { purchaseExportRows } from '../purchaseExport'

const HEAD = ['Purchase Ref', 'Supplier', 'Supply Date', 'Product Name', 'Quantity', 'Unit Cost (NGN)', 'Line Total (NGN)', 'Amount Paid (NGN)']
const plan = (...rows) => buildImportPlan(readPurchaseTable([HEAD, ...rows]).rows, { inventory: [{ id: 'P1', name: 'Paracetamol', price: 80, cost_price: 40, stock: 5 }], today: '2026-11-19' })

describe('upload: a row without a quantity', () => {
  it('is recorded at its Line Total, counted in the purchase, with a warning and no blocking error', () => {
    const p = plan(['INV-9', 'Emzor', '2026-11-03', 'Paracetamol', '100', '45', '', ''], ['INV-9', 'Emzor', '2026-11-03', 'Cotton wool', '', '', '3500', ''])
    expect(p.summary).toMatchObject({ purchases: 1, ready: 1, withErrors: 0, total: 8000 })
    const [line0, line1] = p.purchases[0].form.items
    expect(line0).toMatchObject({ qty: '100', cost: '45' })
    expect(line1).toMatchObject({ name: 'Cotton wool', qty: '', cost: '', noQty: true, amount: '3500' })
    expect(p.purchases[0].warnings.join(' ')).toMatch(/no quantity for Cotton wool, so ₦3,500.00 is recorded for it and no stock is added/)
    expect(p.purchases[0].newProducts).toEqual([])   // it stocks nothing, so no product is created for it
  })

  it('with only a Unit Cost, that figure is the line amount, and the preview says so', () => {
    const p = plan(['INV-9', 'Emzor', '2026-11-03', 'Gauze', '', '1200', '', ''])
    expect(p.purchases[0]).toMatchObject({ total: 1200, errors: [] })
    expect(p.purchases[0].warnings.join(' ')).toMatch(/its Unit Cost, read as the line's amount/)
  })

  it('with no quantity and no amount at all, the row is refused, naming the product', () => {
    const p = plan(['INV-9', 'Emzor', '2026-11-03', 'Gauze', '', '', '', ''])
    expect(p.purchases[0].errors.join(' ')).toMatch(/Gauze has no quantity and no amount/)
  })

  it('a quantity with a Line Total and no Unit Cost works out the unit cost; a disagreeing pair is flagged', () => {
    const a = plan(['INV-9', 'Emzor', '2026-11-03', 'Paracetamol', '10', '', '450', ''])
    expect(a.purchases[0]).toMatchObject({ total: 450, errors: [] })
    expect(Number(a.purchases[0].form.items[0].cost)).toBe(45)
    const b = plan(['INV-9', 'Emzor', '2026-11-03', 'Paracetamol', '10', '45', '500', ''])
    expect(b.purchases[0].total).toBe(450)
    expect(b.purchases[0].warnings.join(' ')).toMatch(/not Quantity x Unit Cost/)
  })

  it('a quantity that is not a number is still an error (blank is the only "unknown")', () => {
    const p = plan(['INV-9', 'Emzor', '2026-11-03', 'Paracetamol', 'abc', '45', '', ''])
    expect(p.purchases[0].errors.join(' ')).toMatch(/Quantity "abc" is not a number/)
  })
})

describe('recording', () => {
  const repos = () => {
    const created = []
    return {
      created,
      purchaseRepository: { create: vi.fn(async (_b, row) => { created.push(row); return [{ id: 'PUR1' }] }) },
      productRepository: { update: vi.fn(async (id, _b, u) => ({ id, ...u })), create: vi.fn(), receiveStock: vi.fn(async () => ({ stock: 105 })) },
      debtRepository: { recordUnderpayment: vi.fn(async () => ({})) },
    }
  }
  const form = {
    supplier: 'Emzor', supplyDate: '2026-11-03', amountPaid: '1000', items: [
      { id: 'l1', productId: 'P1', name: 'Paracetamol', qty: '100', cost: '45', sell: '', batch: '', expiry: '', barcode: '', cat: 'Medicines' },
      { id: 'l2', productId: null, name: 'Cotton wool', qty: '', cost: '', noQty: true, amount: '3500', sell: '', batch: '', expiry: '', barcode: '', cat: 'Medicines' },
    ],
  }

  it('counts the amount in the total and the debt, receives stock only for lines with a quantity', async () => {
    const r = repos()
    const out = await recordPurchase({ businessId: 'B1', form, inventory: [{ id: 'P1', name: 'Paracetamol', price: 80 }], repos: r })
    const row = r.created[0]
    expect(row).toMatchObject({ total_cost: 8000, quantity: 100, cost_price: 45, amount_paid: 1000, balance: 7000, status: 'pending' })
    expect(row.items[1]).toEqual(expect.objectContaining({ id: 'l2', name: 'Cotton wool', qty: null, cost: null, amount: 3500, no_qty: true }))
    expect(r.productRepository.receiveStock).toHaveBeenCalledTimes(1)
    expect(r.productRepository.receiveStock.mock.calls[0][1]).toBe('P1')
    expect(r.productRepository.create).not.toHaveBeenCalled()
    expect(r.debtRepository.recordUnderpayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 8000, amountPaid: 1000 }))
    expect(out).toMatchObject({ total: 8000, balance: 7000, syncFailed: [] })
  })

  it('purchaseFigures: one rule for total, units and the stocked lines', () => {
    expect(purchaseFigures(form)).toMatchObject({ total: 8000, stockedTotal: 4500, qty: 100, balance: 7000 })
  })
})

describe('shown, exported and edited', () => {
  const stored = { total_cost: 8000, items: purchaseItemsFromForm([
    { id: 'l1', productId: 'P1', name: 'Paracetamol', qty: '100', cost: '45' },
    { id: 'l2', productId: null, name: 'Cotton wool', qty: '', cost: '', noQty: true, amount: '3500' },
  ]) }

  it('the invoice shows the amount and no quantity, and the lines add up to the total', () => {
    const { lines } = purchaseLines(stored)
    expect(lines[1]).toMatchObject({ name: 'Cotton wool', qty: null, cost: null, total: 3500, noQty: true })
    expect(lines.reduce((s, l) => s + l.total, 0)).toBe(8000)
  })

  it('the export leaves Quantity and Unit Cost blank and keeps the Line Total, so it uploads again the same', () => {
    const rows = purchaseExportRows({ ...stored, supplier_name: 'Emzor', supply_date: '2026-11-03', amount_paid: 0, balance: 8000 })
    expect(rows[1]).toMatchObject({ qty: '', cost: '', lineTotal: 3500 })
  })

  it('the edit form keeps it amount-only until a quantity is entered', () => {
    const form = formFromPurchase({ supplier_name: 'Emzor', supply_date: '2026-11-03', amount_paid: 0 }, stored.items)
    expect(form.items[1]).toMatchObject({ qty: '', cost: '', noQty: true, amount: '3500' })
    expect(itemProblems(form.items[1])).toEqual({})
    expect(itemProblems({ ...form.items[1], amount: '' })).toEqual({ amount: 'Enter the amount, or the quantity and unit cost' })
    expect(editItemsFromForm([form.items[1]])[0]).toMatchObject({ qty: null, cost: null, amount: 3500, no_qty: true })
    // Quantity entered: a normal line, which then needs a unit cost, and is sent as one.
    const completed = { ...form.items[1], qty: '20' }
    expect(itemProblems(completed)).toMatchObject({ cost: 'Enter the unit cost' })
    expect(editItemsFromForm([{ ...completed, cost: '175' }])[0]).toMatchObject({ qty: 20, cost: 175 })
    expect(editItemsFromForm([{ ...completed, cost: '175' }])[0]).not.toHaveProperty('no_qty')
  })
})
