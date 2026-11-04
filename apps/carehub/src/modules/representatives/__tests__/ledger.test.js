import { describe, it, expect } from 'vitest'
import { toLines, positiveAmount, positionText, summaryRows, detailRows, describeEntry, validPeriod, defaultPeriod, repLedgerError, stockPlan, auditTrail, registerRows, registerFilterText } from '../services/ledger'
import { buildStatementHtml, buildRegisterHtml } from '../services/statementExport'

const P = (id, name) => ({ id, name })
const STATEMENT = {
  company: { name: 'Zenith Pharma Ltd', address: '1 Allen Ave', city: 'Ikeja', state: 'Lagos', phone: '0800', email: 'owner@co.com' },
  representative: { full_name: 'Ada Obi', rep_code: 'REP-001' },
  period: { from: '2026-11-01', to: '2026-11-30' }, generated_at: '2026-11-02T10:00:00Z', currency: 'NGN',
  opening_balance: 500, closing_balance: 6700, position: 'owes',
  totals: { supplies: 10000, payments: 4000, returns: 1600, transfers_in: 2700, transfers_out: 0, adjustments_debit: 0, adjustments_credit: 900, debits: 12700, credits: 6500 },
  entries: [
    { id: 'e1', entry_no: 'RL-1', entry_type: 'supply', entry_date: '2026-11-01', description: 'Products supplied on credit', reference: 'INV-1', debit: 10000, credit: 0, running_balance: 10500,
      lines: [{ product_name: 'Amoxil <500>', quantity: 10, unit_value: 1000, line_value: 10000 }] },
    { id: 'e2', entry_no: 'RL-2', entry_type: 'payment', entry_date: '2026-11-02', description: 'Payment received', payment_method: 'bank_transfer', payment_recipient: 'Accounts', debit: 0, credit: 4000, running_balance: 6500, lines: [] },
  ],
  pending: [],
}

describe('product lines', () => {
  it('converts typed lines to the database shape and totals them', () => {
    expect(toLines([{ product: P('a', 'Amox'), qty: '10', unitValue: '900.555' }, { product: P('b', 'Para'), qty: '2', unitValue: '0' }]))
      .toEqual({ lines: [{ product_id: 'a', qty: 10, unit_value: 900.56 }, { product_id: 'b', qty: 2, unit_value: 0 }], total: 9005.6 })
  })
  it('names the first problem', () => {
    expect(toLines([]).error).toMatch(/at least one product/)
    expect(toLines([{ product: null }]).error).toMatch(/Choose a product/)
    expect(toLines([{ product: P('a', 'Amox'), qty: '1.5', unitValue: '1' }]).error).toMatch(/whole-number quantity for Amox/)
    expect(toLines([{ product: P('a', 'Amox'), qty: '1', unitValue: '' }]).error).toMatch(/value of zero or more for Amox/)
    expect(toLines([{ product: P('a', 'Amox'), qty: '1', unitValue: '1' }, { product: P('a', 'Amox'), qty: '1', unitValue: '1' }]).error).toMatch(/listed twice/)
  })
})

describe('amounts, periods and positions', () => {
  it('accepts only positive amounts, rounded to kobo', () => {
    expect(positiveAmount('100.005')).toBe(100.01)
    expect(positiveAmount('0')).toBeNull()
    expect(positiveAmount('abc')).toBeNull()
  })
  it('describes who owes whom', () => {
    expect(positionText(1500)).toBe('Owes the company ₦1,500.00')
    expect(positionText(-20)).toBe('In credit by ₦20.00')
    expect(positionText(0)).toBe('Settled: nothing owed')
  })
  it('validates and defaults the statement period in the business calendar', () => {
    expect(validPeriod({ from: '2026-11-02', to: '2026-11-01' })).toMatch(/on or before/)
    expect(validPeriod({ from: '', to: '2026-11-01' })).toMatch(/start and an end/)
    expect(validPeriod({ from: '2026-11-01', to: '2026-11-01' })).toBeNull()
    // 23:30 UTC on 31 Oct is already 1 Nov in Lagos.
    expect(defaultPeriod(new Date('2026-10-31T23:30:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' })
  })
})

describe('statement views', () => {
  it('the summary runs from the opening to the closing balance', () => {
    const rows = summaryRows(STATEMENT)
    expect(rows[0]).toEqual(['Opening balance (brought forward)', 500, 'balance'])
    expect(rows[rows.length - 1]).toEqual(['Closing balance (carried forward)', 6700, 'balance'])
    expect(rows.find((r) => r[0] === 'Payments received')[1]).toBe(4000)
  })
  it('the detailed rows carry the database running balance and a readable description', () => {
    const rows = detailRows(STATEMENT)
    expect(rows.map((r) => r.balance)).toEqual([10500, 6500])
    expect(rows[0].description).toBe('Products supplied on credit · 10 × Amoxil <500>')
    expect(describeEntry(STATEMENT.entries[1])).toBe('Payment received · Bank transfer, received by Accounts')
  })
  it('the printable statement shows the header, both balances and escapes text', () => {
    const html = buildStatementHtml(STATEMENT)
    expect(html).toContain('Representative Account Statement')
    expect(html).toContain('Ada Obi (REP-001)')
    expect(html).toContain('Owes the company ₦6,700.00')
    expect(html).toContain('Opening balance brought forward')
    expect(html).toContain('Closing balance carried forward')
    expect(html).toContain('Amoxil &lt;500&gt;')
    expect(html).not.toContain('Amoxil <500>')
    expect(buildStatementHtml(STATEMENT, { view: 'summary' })).not.toContain('<h2>Transactions</h2>')
  })
})

describe('errors', () => {
  it('turns refusals into sentences and keeps raw database text out', () => {
    expect(repLedgerError(new Error('Supabase error (400): Ada Obi holds only 4 of Amoxil 500 on their account.'))).toBe('Ada Obi holds only 4 of Amoxil 500 on their account.')
    expect(repLedgerError(new Error('Supabase error (400): INSUFFICIENT_STOCK: product holds 3 but 10 was requested'))).toBe('Not enough stock: 3 available, 10 needed.')
    expect(repLedgerError(new Error('Supabase error (500): relation "x" does not exist'), 'Try again.')).toBe('Try again.')
  })
})

describe('switch custody plan', () => {
  const preview = { representatives: [{ id: 'r1', full_name: 'Ada', stock: [{ company_product_id: 'p1', product_name: 'Amox', custody: 4, carry: 4 }] }] }
  it('sends only the lines the owner changed', () => {
    expect(stockPlan(preview, {})).toEqual({ plan: [] })
    expect(stockPlan(preview, { 'r1:p1': '2' })).toEqual({ plan: [{ representative_id: 'r1', company_product_id: 'p1', qty: 2 }] })
  })
  it('refuses a quantity outside 0..custody', () => {
    expect(stockPlan(preview, { 'r1:p1': '5' }).error).toMatch(/from 0 to 4/)
    expect(stockPlan(preview, { 'r1:p1': '-1' }).error).toMatch(/from 0 to 4/)
  })
})

const REGISTER = {
  period: { from: '2026-11-01', to: '2026-11-30' }, generated_at: '2026-11-04T10:00:00Z', currency: 'NGN',
  filters: { representative_name: 'Ada Obi', entry_type: 'transfer', product_name: null, territory_name: 'Lagos <Mainland>' },
  totals: { count: 3, posted: 2, pending: 0, rejected: 1, debits: 900, credits: 900 },
  entries: [
    { id: 'a', entry_no: 'RL-5', entry_type: 'transfer_out', status: 'posted', entry_date: '2026-11-03', description: 'Transferred to Bayo Ade', reason: 'Cover',
      debit: 0, credit: 900, representative_name: 'Ada Obi', rep_code: 'REP-001', territory_name: 'Lagos <Mainland>', operating_model: 'centralised',
      created_by_name: 'Musa', decided_by_name: 'Mrs Owner', reversed_by_entry_no: 'RL-9', lines: [{ product_name: 'Amoxil', quantity: 1 }] },
    { id: 'b', entry_no: 'RL-6', entry_type: 'transfer_out', status: 'rejected', entry_date: '2026-11-04', description: 'Transferred to Bayo Ade',
      debit: 0, credit: 0, representative_name: 'Ada Obi', rep_code: 'REP-001', created_by_name: 'Musa', decided_by_name: 'Mrs Owner', decision_note: 'Wrong rep', lines: [] },
    { id: 'c', entry_no: 'RL-9', entry_type: 'reversal', status: 'posted', entry_date: '2026-11-05', description: 'Reversal of RL-5', debit: 900, credit: 0,
      representative_name: 'Ada Obi', rep_code: 'REP-001', created_by_name: 'Mrs Owner', decided_by_name: 'Mrs Owner', reverses_entry_no: 'RL-5', lines: [] },
  ],
}

describe('the transaction register and its audit trail', () => {
  it('says who recorded, approved, rejected and reversed each entry', () => {
    expect(auditTrail(REGISTER.entries[0])).toBe('Recorded by Musa · Approved by Mrs Owner · Reversed by RL-9')
    expect(auditTrail(REGISTER.entries[1])).toBe('Recorded by Musa · Rejected by Mrs Owner (Wrong rep)')
    // The person who recorded and posted it at once is not repeated as an approver.
    expect(auditTrail(REGISTER.entries[2])).toBe('Recorded by Mrs Owner · Reverses RL-5')
    expect(auditTrail({ status: 'pending', created_by_name: 'Musa' })).toBe('Recorded by Musa · Awaiting approval')
  })
  it('shapes rows with the database figures unchanged', () => {
    const rows = registerRows(REGISTER)
    expect(rows.map((r) => [r.entryNo, r.type, r.status, r.posted, r.debit, r.credit])).toEqual([
      ['RL-5', 'Transfer out', 'Posted', true, 0, 900], ['RL-6', 'Transfer out', 'Rejected', false, 0, 0], ['RL-9', 'Reversal', 'Posted', true, 900, 0]])
    expect(rows[0]).toMatchObject({ representative: 'Ada Obi (REP-001)', territory: 'Lagos <Mainland>', model: 'Centralised' })
    expect(rows[0].description).toBe('Transferred to Bayo Ade · 1 × Amoxil · Cover')
  })
  it('names the filters it was run with', () => {
    expect(registerFilterText(REGISTER)).toBe('Ada Obi · Transfers · Lagos <Mainland>')
    expect(registerFilterText({ filters: {} })).toMatch(/^All representatives/)
  })
  it('the printable register escapes text and counts only posted entries', () => {
    const html = buildRegisterHtml(REGISTER, 'Zenith <Pharma>')
    expect(html).toContain('Zenith &lt;Pharma&gt;')
    expect(html).toContain('Lagos &lt;Mainland&gt;')
    expect(html).not.toContain('Lagos <Mainland>')
    expect(html).toContain('Total of 2 posted entries (0 awaiting approval and 1 rejected are listed but not counted)')
    expect(html).toContain('Rejected by Mrs Owner (Wrong rep)')
  })
  it('statement rows carry who recorded and approved each entry', () => {
    const rows = detailRows({ entries: [{ ...STATEMENT.entries[0], created_by_name: 'Musa', decided_by_name: 'Mrs Owner' }, { ...STATEMENT.entries[1], created_by_name: 'Musa', decided_by_name: 'Musa' }] })
    expect(rows.map((r) => [r.recordedBy, r.approvedBy])).toEqual([['Musa', 'Mrs Owner'], ['Musa', '']])
    expect(buildStatementHtml({ ...STATEMENT, entries: [{ ...STATEMENT.entries[0], created_by_name: 'Musa <M>' }] })).toContain('Recorded by Musa &lt;M&gt;')
  })
})
