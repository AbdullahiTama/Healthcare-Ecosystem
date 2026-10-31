import { describe, it, expect } from 'vitest'
import {
  periodRange, parseDbTime, isCompletedSale, parseItems, saleReceived, saleOutstanding,
  paymentStatus, filterSales, filterPayments, summarise, toReportRows, filterOptions, EMPTY_FILTERS, expectedCash,
  sumTotalSales, reportView, isDeletionReversal,
} from './salesReport'

// Periods are business days in Lagos (UTC+1, no daylight saving), whatever
// zone the device or the test runner is in (lib/businessDay.test.js covers the
// boundaries). A fixed "now": Wednesday 2026-10-21 15:30 Lagos time.
const lagos = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 1, min))
const NOW = lagos(2026, 10, 21, 15, 30)

describe('periodRange', () => {
  it('today runs from Lagos midnight to the next Lagos midnight', () => {
    const r = periodRange('today', { now: NOW })
    expect(r.start).toEqual(lagos(2026, 10, 21))
    expect(r.end).toEqual(lagos(2026, 10, 22))
  })
  it('yesterday is the previous Lagos day', () => {
    const r = periodRange('yesterday', { now: NOW })
    expect(r.start).toEqual(lagos(2026, 10, 20))
    expect(r.end).toEqual(lagos(2026, 10, 21))
  })
  it('this week starts on Monday', () => {
    const r = periodRange('week', { now: NOW })
    expect(r.start).toEqual(lagos(2026, 10, 19))
    expect(r.end).toEqual(lagos(2026, 10, 26))
  })
  it('this week on a Sunday still starts on the Monday before', () => {
    const r = periodRange('week', { now: lagos(2026, 10, 25, 9) })
    expect(r.start).toEqual(lagos(2026, 10, 19))
  })
  it('this month and this year', () => {
    expect(periodRange('month', { now: NOW })).toEqual({ start: lagos(2026, 10, 1), end: lagos(2026, 11, 1) })
    expect(periodRange('year', { now: NOW })).toEqual({ start: lagos(2026, 1, 1), end: lagos(2027, 1, 1) })
  })
  it('custom is inclusive of both days', () => {
    const r = periodRange('custom', { from: '2026-10-01', to: '2026-10-03' })
    expect(r.start).toEqual(lagos(2026, 10, 1))
    expect(r.end).toEqual(lagos(2026, 10, 4))
  })
  it('a sale at 00:20 Lagos time is in that day, not the day before', () => {
    // Stored as 23:20 UTC the previous day; the old UTC cut put it on the 18th.
    const at = parseDbTime('2026-07-18T23:20:31')
    const r = periodRange('today', { now: lagos(2026, 7, 19, 12) })
    expect(at >= r.start && at < r.end).toBe(true)
  })
  it('custom with the dates reversed or missing is not a range', () => {
    expect(periodRange('custom', { from: '2026-10-05', to: '2026-10-03' })).toBeNull()
    expect(periodRange('custom', { from: '', to: '2026-10-03' })).toBeNull()
    expect(periodRange('custom', { from: 'nonsense', to: '2026-10-03' })).toBeNull()
  })
})

describe('parseDbTime', () => {
  it('reads a zone-less database timestamp as UTC (sales.created_at is stored in UTC)', () => {
    expect(parseDbTime('2026-10-21T23:30:00').toISOString()).toBe('2026-10-21T23:30:00.000Z')
  })
  it('keeps an explicit zone', () => {
    expect(parseDbTime('2026-10-21T23:30:00+00:00').toISOString()).toBe('2026-10-21T23:30:00.000Z')
    expect(parseDbTime('2026-10-21T23:30:00.5Z').toISOString()).toBe('2026-10-21T23:30:00.500Z')
  })
  it('returns null for nothing or garbage', () => {
    expect(parseDbTime(null)).toBeNull()
    expect(parseDbTime('x')).toBeNull()
  })
})

describe('sale helpers', () => {
  it('completed means not held and status empty or completed', () => {
    expect(isCompletedSale({ is_on_hold: false, status: null })).toBe(true)
    expect(isCompletedSale({ status: 'completed' })).toBe(true)
    expect(isCompletedSale({ is_on_hold: true })).toBe(false)
    expect(isCompletedSale({ status: 'deleted' })).toBe(false)
    expect(isCompletedSale({ status: 'resumed' })).toBe(false)
  })
  it('parses items stored as an array, a JSON string, or a doubly encoded string', () => {
    const items = [{ id: 'p1', name: 'Amoxil', qty: 2, price: 500 }]
    expect(parseItems(items)).toEqual(items)
    expect(parseItems(JSON.stringify(items))).toEqual(items)
    expect(parseItems(JSON.stringify(JSON.stringify(items)))).toEqual(items)
    expect(parseItems('not json')).toEqual([])
    expect(parseItems(null)).toEqual([])
  })
  it('received excludes change; outstanding is what is left of the total', () => {
    expect(saleReceived({ total: 3000, amount_paid: 5000 })).toBe(3000)
    expect(saleReceived({ total: 100000, amount_paid: 70000 })).toBe(70000)
    expect(saleOutstanding({ total: 100000, amount_paid: 70000 })).toBe(30000)
    expect(saleOutstanding({ total: 3000, amount_paid: 5000 })).toBe(0)
    expect(saleReceived({ total: '2500.50', amount_paid: '2500.50' })).toBe(2500.5)
  })
  it('payment status', () => {
    expect(paymentStatus({ total: 1000, amount_paid: 1000 })).toBe('Paid')
    expect(paymentStatus({ total: 1000, amount_paid: 400 })).toBe('Part-paid')
    expect(paymentStatus({ total: 1000, amount_paid: 0 })).toBe('Unpaid')
    expect(paymentStatus({ total: 0, amount_paid: 0 })).toBe('Paid')
  })
})

// ── Fixtures for filtering and the summary ────────────────────────────────────
const sale = (o) => ({
  business_id: 'A', is_on_hold: false, status: null, discount: 0, refunded_amount: 0,
  client_name: 'Walk-in', client_id: null, items: [], payment_method: 'Cash', created_at: '2026-10-21T10:00:00', ...o,
})
const pay = (o) => ({ kind: 'sale', method: 'Cash', received_at: '2026-10-21T10:00:00+00:00', shift_id: null, ...o })

const SALES = [
  // The request's example: ₦100,000 sold, ₦70,000 paid by transfer, ₦30,000 owed.
  sale({ id: 's1', txn_no: 'TXN-1', client_id: 'c1', client_name: 'Bola', total: 100000, amount_paid: 70000, payment_method: 'Credit',
    items: JSON.stringify([{ id: 'p1', name: 'Amoxil', qty: 10, price: 10000 }]), cashier_user_id: 'u1', staff_name: 'Rep One', shift_id: 'sh1' }),
  // Cash sale with change, a discount, and a later partial refund.
  sale({ id: 's2', txn_no: 'TXN-2', total: 3000, amount_paid: 5000, discount: 200, refunded_amount: 500,
    items: [{ id: 'p2', name: 'Panadol', qty: 3, price: 1066.67 }], cashier_user_id: 'u2', staff_name: 'Rep Two' }),
  // A split sale.
  sale({ id: 's3', txn_no: 'TXN-3', total: 2000, amount_paid: 2000, payment_method: 'Split',
    items: [{ product_id: 'p1', name: 'Amoxil', qty: 1, price: 2000 }], cashier_user_id: 'u1', staff_name: 'Rep One', shift_id: 'sh1' }),
  // Not sales: held and deleted rows never count.
  sale({ id: 's4', txn_no: 'HLD-1', total: 900, amount_paid: 0, is_on_hold: true }),
  sale({ id: 's5', txn_no: 'TXN-5', total: 800, amount_paid: 800, status: 'deleted' }),
]
const PAYMENTS = [
  pay({ sale_id: 's1', method: 'Transfer', amount: 70000, received_by: 'u1', staff_name: 'Rep One', shift_id: 'sh1' }),
  pay({ sale_id: 's2', method: 'Cash', amount: 3000, received_by: 'u2', staff_name: 'Rep Two' }),
  pay({ sale_id: 's3', method: 'Transfer', amount: 1500, received_by: 'u1', staff_name: 'Rep One', shift_id: 'sh1' }),
  pay({ sale_id: 's3', method: 'Cash', amount: 500, received_by: 'u1', staff_name: 'Rep One', shift_id: 'sh1' }),
  pay({ sale_id: 's2', kind: 'refund', method: 'Cash', amount: 500, received_by: 'u3', staff_name: 'Manager' }),
  // A repayment today on a sale made last month: money in today, sale not in today's sales.
  pay({ sale_id: 'old', kind: 'collection', method: 'POS', amount: 4000, received_by: 'u2', staff_name: 'Rep Two' }),
]
const OLD_SALE = sale({ id: 'old', txn_no: 'TXN-0', client_id: 'c1', client_name: 'Bola', total: 10000, amount_paid: 10000, created_at: '2026-09-10T10:00:00', cashier_user_id: 'u1' })
const byId = Object.fromEntries([...SALES, OLD_SALE].map((s) => [s.id, s]))

describe('filterSales', () => {
  it('drops held and deleted rows always', () => {
    expect(filterSales(SALES, EMPTY_FILTERS).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })
  it('by customer, product (id or product_id), method, status, cashier, shift', () => {
    const ids = (f) => filterSales(SALES, { ...EMPTY_FILTERS, ...f }).map((s) => s.id)
    expect(ids({ customer: 'id:c1' })).toEqual(['s1'])
    expect(ids({ customer: 'name:walk-in' })).toEqual(['s2', 's3'])
    expect(ids({ product: 'p1' })).toEqual(['s1', 's3'])
    expect(ids({ method: 'Split' })).toEqual(['s3'])
    expect(ids({ status: 'Part-paid' })).toEqual(['s1'])
    expect(ids({ status: 'Refund' })).toEqual(['s2'])
    expect(ids({ cashier: 'u1' })).toEqual(['s1', 's3'])
    expect(ids({ shift: 'sh1' })).toEqual(['s1', 's3'])
    expect(ids({ shift: 'none' })).toEqual(['s2'])
  })
  it('a sale with no recorded cashier is reachable by name, then as "none"', () => {
    const rows = [sale({ id: 'x', staff_name: 'Old Name' }), sale({ id: 'y' })]
    expect(filterSales(rows, { ...EMPTY_FILTERS, cashier: 'name:Old Name' }).map((s) => s.id)).toEqual(['x'])
    expect(filterSales(rows, { ...EMPTY_FILTERS, cashier: 'none' }).map((s) => s.id)).toEqual(['y'])
  })
})

describe('filterPayments', () => {
  it('cashier and shift follow who took the money, not who made the sale', () => {
    const got = filterPayments(PAYMENTS, byId, { ...EMPTY_FILTERS, cashier: 'u2' })
    expect(got.map((p) => p.amount)).toEqual([3000, 4000])
  })
  it('customer, product, method and status follow the sale the money belongs to', () => {
    const got = filterPayments(PAYMENTS, byId, { ...EMPTY_FILTERS, customer: 'id:c1' })
    expect(got.map((p) => p.sale_id)).toEqual(['s1', 'old'])
  })
  it('a sale-level filter excludes payments whose sale is unknown', () => {
    expect(filterPayments([pay({ sale_id: 'ghost', amount: 1 })], byId, { ...EMPTY_FILTERS, method: 'Cash' })).toEqual([])
  })
})

describe('summarise', () => {
  const all = summarise({ sales: filterSales(SALES, EMPTY_FILTERS), payments: PAYMENTS, ledgerAvailable: true })

  it('the request example reconciles: sales vs received vs outstanding', () => {
    const s = summarise({ sales: [SALES[0]], payments: [PAYMENTS[0]], ledgerAvailable: true })
    expect(s.totalSales).toBe(100000)
    expect(s.received.total).toBe(70000)
    expect(s.outstanding).toBe(30000)
    expect(s.credit).toEqual({ count: 1, amount: 30000 })
  })
  it('totals, discounts and transaction count', () => {
    expect(all.totalSales).toBe(105000)
    expect(all.discounts).toBe(200)
    expect(all.transactions).toBe(3)
  })
  it('received is split by method, includes collections, and never counts change', () => {
    expect(all.received).toEqual({ total: 79000, Cash: 3500, Transfer: 71500, POS: 4000, Unspecified: 0 })
    expect(all.collections).toBe(4000)
  })
  it('refunds come off received to give net', () => {
    expect(all.refunds).toEqual({ total: 500, Cash: 500, Transfer: 0, POS: 0, Unspecified: 0 })
    expect(all.netReceived).toBe(78500)
  })
  it('cash in hand = cash received minus cash refunded', () => {
    expect(all.cashInHand).toBe(3000)
  })
  it('credit given counts only the part not paid at the till', () => {
    expect(all.credit).toEqual({ count: 1, amount: 30000 })
  })
  it('an empty set is all zeros, not NaN', () => {
    const z = summarise({ sales: [], payments: [], ledgerAvailable: true })
    expect(z.totalSales).toBe(0)
    expect(z.received.total).toBe(0)
    expect(z.netReceived).toBe(0)
  })
  it('without the ledger, money is estimated from the sales and flagged', () => {
    const s = summarise({ sales: filterSales(SALES, EMPTY_FILTERS), payments: [], ledgerAvailable: false })
    expect(s.estimated).toBe(true)
    // s1 Credit 70000 has no recorded method; s2 cash 3000 (change excluded); s3 split has no amounts → Unspecified.
    expect(s.received.total).toBe(75000)
    expect(s.received.Cash).toBe(3000)
    expect(s.received.Unspecified).toBe(72000)
    expect(s.refunds.total).toBe(500)
  })
  it('without the ledger, split amounts stored as a JSON string are used', () => {
    const s = summarise({
      sales: [sale({ id: 'z', total: 2000, amount_paid: 2500, payment_method: 'Split', payment_split: JSON.stringify({ Cash: '1000', Transfer: '1500', POS: '' }) })],
      payments: [], ledgerAvailable: false,
    })
    expect(s.received).toEqual({ total: 2000, Cash: 500, Transfer: 1500, POS: 0, Unspecified: 0 })
  })
})

describe('toReportRows', () => {
  it('flattens a sale for the table and the exports, without cost data', () => {
    const items = [{ id: 'p1', name: 'Amoxil', qty: 2, price: 500, cost_price: 300 }, { id: 'p2', name: 'Panadol', qty: 1, price: 200, cost_price: 100 }]
    const [row] = toReportRows([sale({ id: 'r', txn_no: 'TXN-9', client_name: 'Ada', total: 1200, amount_paid: 1000, items, staff_name: 'Rep One', shift_id: 'sh1' })],
      { shiftsById: { sh1: { id: 'sh1', staff_name: 'Rep One', opened_at: '2026-10-21T08:00:00+00:00' } } })
    expect(row).toMatchObject({ receipt: 'TXN-9', customer: 'Ada', products: 'Amoxil ×2, Panadol ×1', quantity: 3,
      total: 1200, paid: 1000, outstanding: 200, refunded: 0, method: 'Cash', status: 'Part-paid', cashier: 'Rep One' })
    expect(row.date.toISOString()).toBe('2026-10-21T10:00:00.000Z')
    expect(row.shift).toMatch(/^Rep One · /)
    expect(JSON.stringify(row)).not.toMatch(/cost/i)
  })
  it('says so when the cashier was never recorded', () => {
    const [row] = toReportRows([sale({ id: 'r', total: 1, amount_paid: 1 })])
    expect(row.cashier).toBe('Not recorded')
    expect(row.shift).toBe('No shift')
  })
  it('names the methods of a split', () => {
    const [row] = toReportRows([sale({ id: 'r', total: 2, amount_paid: 2, payment_method: 'Split', payment_split: '{"Cash":"1","Transfer":"1","POS":""}' })])
    expect(row.method).toBe('Split (Cash, Transfer)')
  })
})

describe('filterOptions', () => {
  it('lists customers, products, cashiers and shifts found in the period, sorted', () => {
    const o = filterOptions(filterSales(SALES, EMPTY_FILTERS), PAYMENTS, [{ id: 'sh1', staff_name: 'Rep One', opened_at: '2026-10-21T08:00:00+00:00' }])
    expect(o.customers.map((c) => c.label)).toEqual(['Bola', 'Walk-in'])
    expect(o.products).toEqual([{ value: 'p1', label: 'Amoxil' }, { value: 'p2', label: 'Panadol' }])
    expect(o.cashiers.map((c) => c.value)).toEqual(['u3', 'u1', 'u2']) // Manager, Rep One, Rep Two
    expect(o.shifts[0].value).toBe('sh1')
  })
})

describe('expectedCash', () => {
  it('is the opening float plus cash taken, less cash refunded, in that shift (the server rule)', () => {
    const shift = { id: 'sh1', opening_float: '5000' }
    const rows = [
      pay({ shift_id: 'sh1', method: 'Cash', amount: 4000 }),
      pay({ shift_id: 'sh1', method: 'Cash', kind: 'collection', amount: 1000 }),
      pay({ shift_id: 'sh1', method: 'Transfer', amount: 9000 }),
      pay({ shift_id: 'sh1', method: 'Cash', kind: 'refund', amount: 300 }),
      pay({ shift_id: 'other', method: 'Cash', amount: 777 }),
    ]
    expect(expectedCash(shift, rows)).toBe(9700)
  })
  it('a shift with no payments expects its float', () => {
    expect(expectedCash({ id: 'x', opening_float: 2500 }, [])).toBe(2500)
  })
})

describe('one set of figures for every screen (financial consistency audit)', () => {
  // The shape of Pharmacy A's day after holding and completing invoices: every
  // completed hold leaves its held row behind as 'converted', with the same total.
  const at = '2026-10-30T10:00:00'
  const data = {
    sales: [
      { id: 'a', total: 5000, amount_paid: 5000, payment_method: 'Cash', created_at: at, is_on_hold: false, status: null },
      { id: 'b', total: 3000, amount_paid: 3000, payment_method: 'Transfer', created_at: at, is_on_hold: false, status: null, resumed_from: 'conv' },
      { id: 'conv', total: 3000, amount_paid: 0, payment_method: 'Transfer', created_at: at, is_on_hold: false, status: 'converted' },
      { id: 'res', total: 900, payment_method: 'Cash', created_at: at, is_on_hold: false, status: 'resumed' },
      { id: 'del', total: 1200, amount_paid: 1200, payment_method: 'Cash', created_at: at, is_on_hold: false, status: 'deleted' },
      { id: 'held', total: 700, payment_method: 'Cash', created_at: at, is_on_hold: true, status: null },
    ],
    payments: [
      { id: 'p1', sale_id: 'a', kind: 'sale', method: 'Cash', amount: 5000 },
      { id: 'p2', sale_id: 'b', kind: 'sale', method: 'Transfer', amount: 3000 },
      { id: 'p3', sale_id: 'del', kind: 'sale', method: 'Cash', amount: 1200 },
      { id: 'p4', sale_id: 'del', kind: 'refund', method: 'Cash', amount: 1200, note: 'Sale deleted: rung up twice' },
      { id: 'p5', sale_id: 'a', kind: 'refund', method: 'Cash', amount: 500, note: 'Expired item returned' },
    ],
    ledgerAvailable: true,
  }
  data.salesById = Object.fromEntries(data.sales.map((s) => [s.id, s]))

  it('counts held, converted, resumed and deleted rows nowhere', () => {
    const { sales, summary } = reportView(data)
    expect(sales.map((s) => s.id)).toEqual(['a', 'b'])
    expect(summary.totalSales).toBe(8000)
    expect(summary.transactions).toBe(2)
  })

  it('total sales is gross; refunds are reported beside it', () => {
    expect(sumTotalSales([{ total: 1000, refunded_amount: 1000 }, { total: '250.5' }])).toBe(1250.5)
    expect(reportView(data).summary.refunds.total).toBe(500)
  })

  it("an owner's deletion is a reversal, not a refund, and net received counts both", () => {
    expect(isDeletionReversal(data.payments[3])).toBe(true)
    expect(isDeletionReversal(data.payments[4])).toBe(false)
    const { summary } = reportView(data)
    expect(summary.reversals.total).toBe(1200)
    expect(summary.received.total).toBe(9200)
    expect(summary.netReceived).toBe(7500)
    expect(summary.cashInHand).toBe(4500)
  })

  it('reportView applies the same filters as the report screen', () => {
    const f = { ...EMPTY_FILTERS, method: 'Transfer' }
    const { sales, summary } = reportView(data, f)
    expect(sales.map((s) => s.id)).toEqual(['b'])
    expect(summary).toEqual(summarise({ sales: filterSales(data.sales, f), payments: filterPayments(data.payments, data.salesById, f) }))
  })
})
