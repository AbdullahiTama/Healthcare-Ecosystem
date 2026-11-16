import { describe, it, expect } from 'vitest'
import { buildClientLedger, clientStatement, accountSummary, summaryLines, balanceStatus, balanceText } from './clientLedger'

// Ada's account, live-shaped:
//   2026-09-30 opening balance: she owed ₦2,000 before CareHub (paid ₦500 on 10-05)
//   2026-10-01 S1 credit sale ₦10,000, ₦4,000 paid at the sale, ₦3,000 collected 10-10
//   2026-10-12 S2 cash sale ₦3,000 (paid), ₦1,000 of it returned and refunded 10-13
//   2026-10-20 S3 legacy sale ₦1,500, no payment rows, amount_paid 1,500
//   2026-11-02 credit to client ₦800 (we owe her), ₦300 paid back to her 11-03
//   2026-11-05 S4 cash ₦2,000 with ₦2,500 of payment rows (₦500 change)
//   not counted: a held sale, a deleted sale, the credit-sale debt mirroring S1, another client's payment row
const sales = [
  { id: 's1', txn_no: 'TXN-1', created_at: '2026-10-01T09:00:00', total: 10000, amount_paid: 7000, balance: 3000, payment_method: 'Credit', items: JSON.stringify([{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }]) },
  { id: 's2', txn_no: 'TXN-2', created_at: '2026-10-12T10:00:00', total: 3000, amount_paid: 3000, balance: 0, refunded_amount: 1000, items: '[]' },
  { id: 's3', txn_no: 'TXN-3', created_at: '2026-10-20T11:00:00', total: 1500, amount_paid: 1500, balance: 0, payment_method: 'Cash' },
  { id: 's4', txn_no: 'TXN-4', created_at: '2026-11-05T11:00:00', total: 2000, amount_paid: 2500, balance: 0 },
  { id: 'h1', txn_no: 'HLD-1', created_at: '2026-10-02T09:00:00', total: 999, is_on_hold: true },
  { id: 'd1', txn_no: 'TXN-DEL', created_at: '2026-10-03T09:00:00', total: 777, status: 'deleted' },
]
const salePayments = [
  { id: 'p1', sale_id: 's1', kind: 'sale', method: 'Cash', amount: 4000, received_at: '2026-10-01T09:00:01Z' },
  { id: 'p2', sale_id: 's1', kind: 'collection', method: 'Transfer', amount: 3000, received_at: '2026-10-10T12:00:00Z' },
  { id: 'p3', sale_id: 's2', kind: 'sale', method: 'POS', amount: 3000, received_at: '2026-10-12T10:00:01Z' },
  { id: 'p4', sale_id: 's2', kind: 'refund', method: 'Cash', amount: 1000, received_at: '2026-10-13T08:00:00Z', note: 'Damaged pack' },
  { id: 'p5', sale_id: 's4', kind: 'sale', method: 'Cash', amount: 2500, received_at: '2026-11-05T11:00:01Z' },
  { id: 'p9', sale_id: 'other', kind: 'collection', amount: 5000, received_at: '2026-10-10T12:00:00Z' },
]
const debts = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', direction: 'owes_us', source: 'manual', source_ref: 'opening_balance', amount: 2000, amount_paid: 500, balance: 1500, created_at: '2026-09-30T00:00:00' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000002', direction: 'we_owe', source: 'manual', source_ref: '', description: 'Deposit for order', amount: 800, amount_paid: 300, balance: 500, created_at: '2026-11-02T08:00:00' },
  { id: 'cccccccc-0000-0000-0000-000000000003', direction: 'owes_us', source: 'credit_sale', source_ref: 'TXN-1', amount: 10000, balance: 3000, created_at: '2026-10-01T09:00:00' },
]
const debtPayments = [
  { id: 'q1', debt_id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'payment', method: 'Cash', amount: 500, paid_on: '2026-10-05' },
  { id: 'q2', debt_id: 'bbbbbbbb-0000-0000-0000-000000000002', kind: 'payment', method: 'Transfer', amount: 300, paid_on: '2026-11-03' },
  { id: 'q3', debt_id: 'cccccccc-0000-0000-0000-000000000003', kind: 'payment', amount: 99, paid_on: '2026-10-05' },
]
const ledger = buildClientLedger({ sales, salePayments, debts, debtPayments })
const line = (id) => ledger.find((e) => e.id === id)

describe('buildClientLedger', () => {
  it('lists every entry in date order with the right side of the account', () => {
    expect(ledger.map((e) => [e.date, e.kind, e.ref, e.debit, e.credit])).toEqual([
      ['2026-09-30', 'opening', 'D-AAAAAAAA', 2000, 0],
      ['2026-10-01', 'sale', 'TXN-1', 10000, 0],
      ['2026-10-01', 'payment', 'TXN-1', 0, 4000],
      ['2026-10-05', 'payment', 'D-AAAAAAAA', 0, 500],
      ['2026-10-10', 'payment', 'TXN-1', 0, 3000],
      ['2026-10-12', 'sale', 'TXN-2', 3000, 0],
      ['2026-10-12', 'payment', 'TXN-2', 0, 3000],
      ['2026-10-13', 'return', 'TXN-2', 0, 1000],
      ['2026-10-13', 'refund', 'TXN-2', 1000, 0],
      ['2026-10-20', 'sale', 'TXN-3', 1500, 0],
      ['2026-10-20', 'payment', 'TXN-3', 0, 1500],
      ['2026-11-02', 'adjustment', 'D-BBBBBBBB', 0, 800],
      ['2026-11-03', 'payout', 'D-BBBBBBBB', 300, 0],
      ['2026-11-05', 'sale', 'TXN-4', 2000, 0],
      ['2026-11-05', 'payment', 'TXN-4', 0, 2000],
    ])
  })

  it('describes entries in plain words', () => {
    expect(line('sale:s1').description).toBe('Sale · 2 items')
    expect(line('pay:p2').description).toBe('Payment received · Transfer')
    expect(line('return:p4').description).toBe('Return accepted · Damaged pack')
    expect(line('refund:p4').description).toBe('Refund paid · Cash')
    expect(line('salepaid:s3').description).toBe('Payment at sale · Cash')
    expect(line('pay:p5').description).toBe('Payment at sale · Cash (₦500 change)')
    expect(line('debt:aaaaaaaa-0000-0000-0000-000000000001').description).toBe('Opening balance: client owes us')
    expect(line('debt:bbbbbbbb-0000-0000-0000-000000000002').description).toBe('Credit to client: Deposit for order')
    expect(line('debtpay:q2').description).toBe('Paid to client · Transfer')
  })

  it('leaves out held and deleted sales, credit-sale debts (they mirror the sale) and other sales\' payments', () => {
    const ids = ledger.map((e) => e.id).join(' ')
    expect(ids).not.toMatch(/h1|d1|cccccccc|q3|p9/)
  })

  it('closes at the sales\' own balances plus the recorded debts\' balances', () => {
    // S1 3,000 + opening 1,500 − credit 500 (S2, S3, S4 are paid; the return was refunded).
    expect(clientStatement(ledger).closing).toBe(4000)
    const fromRecords = sales.filter((s) => !s.is_on_hold && !s.status).reduce((t, s) => t + s.balance, 0) + 1500 - 500
    expect(clientStatement(ledger).closing).toBe(fromRecords)
  })

  it('dates a payment made before payment history began on the debt itself', () => {
    const l = buildClientLedger({ debts: [debts[0]], debtPayments: [{ id: 'bh', debt_id: debts[0].id, kind: 'before_history', amount: 500, paid_on: null, created_at: '2026-11-15T10:00:00Z' }] })
    expect(l.find((e) => e.id === 'debtpay:bh').date).toBe('2026-09-30')
  })
})

describe('clientStatement', () => {
  it('carries everything before the period in as the opening balance, with a running balance', () => {
    const oct = clientStatement(ledger, { from: '2026-10-01', to: '2026-10-31' })
    expect(oct.opening).toBe(2000)
    expect(oct.entries[0]).toMatchObject({ kind: 'sale', balance: 12000 })
    expect(oct.closing).toBe(4500)
    expect(oct.totals).toMatchObject({ purchases: 14500, payments: 12000, returns: 1000, refunds: 1000 })
  })

  it('the closing balance of one period is the opening balance of the next', () => {
    const oct = clientStatement(ledger, { from: '2026-10-01', to: '2026-10-31' })
    const nov = clientStatement(ledger, { from: '2026-11-01', to: '2026-11-30' })
    expect(nov.opening).toBe(oct.closing)
    expect(nov.closing).toBe(clientStatement(ledger).closing)
    expect(nov.entries.at(-1).balance).toBe(nov.closing)
  })

  it('an empty period still has its opening and closing balance', () => {
    const st = clientStatement(ledger, { from: '2026-12-01', to: '2026-12-31' })
    expect(st).toMatchObject({ opening: 4000, closing: 4000, entries: [] })
  })

  it('summary lines add up to the closing balance', () => {
    const st = clientStatement(ledger, { from: '2026-10-01', to: '2026-11-30' })
    const lines = summaryLines(st)
    expect(lines[0]).toEqual(['Opening balance at 2026-10-01', 2000, 'balance'])
    expect(lines.at(-1)).toEqual(['Closing balance at 2026-11-30', 4000, 'balance'])
    const movement = lines.slice(1, -1).reduce((t, [, v]) => t + v, 0)
    expect(Math.round((st.opening + movement) * 100) / 100).toBe(st.closing)
  })
})

describe('accountSummary', () => {
  it('gives purchases, payments, returns, outstanding, available credit and status', () => {
    expect(accountSummary(ledger, { openSales: 1, openDebts: 2 })).toMatchObject({
      purchases: 16500, payments: 14000, returns: 1000, refunds: 1000, outstanding: 4000, availableCredit: 0, balance: 4000,
      status: { status: 'owes', label: 'Client owes us', amount: 4000 }, openItems: 3,
    })
  })

  it('a client in credit has available credit and nothing outstanding', () => {
    const l = buildClientLedger({ debts: [{ id: 'x', direction: 'we_owe', source: 'manual', source_ref: 'opening_balance', amount: 2500, created_at: '2026-10-31' }] })
    expect(accountSummary(l)).toMatchObject({ outstanding: 0, availableCredit: 2500, status: { status: 'credit', label: 'We owe client' } })
    expect(accountSummary([])).toMatchObject({ outstanding: 0, availableCredit: 0, status: { status: 'clear', label: 'Settled' } })
  })

  it('reads balances in words', () => {
    const fmt = (n) => '₦' + n
    expect(balanceStatus(-0.004).status).toBe('clear')
    expect(balanceText(300, fmt)).toBe('₦300 owed by the client')
    expect(balanceText(-300, fmt)).toBe("₦300 in the client's favour")
  })
})
