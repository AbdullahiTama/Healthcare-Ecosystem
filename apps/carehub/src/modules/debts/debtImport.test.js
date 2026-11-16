import { describe, it, expect } from 'vitest'
import { readDebtTable, prepareDebtRows, mergeImportResult, debtExportRows, debtExportColumns, debtRef, buildDebtTemplateCsv, DEBT_IMPORT } from './debtImport'

describe('reading a debts file', () => {
  it('matches headers in any order, with alternative names, and reports missing and unused columns', () => {
    const t = readDebtTable([['Phone', 'Client Name', 'Amount', 'Colour'], ['0803', 'Ada', '500', 'red']], 'owes_us')
    expect(t.missing).toEqual([])
    expect(t.ignored).toEqual(['Colour'])
    expect(t.rows).toEqual([{ rowNumber: 2, cells: { phone: '0803', party: 'Ada', amount: '500' } }])
    expect(readDebtTable([['Supplier', 'Notes'], ['Emzor', 'x']], 'we_owe').missing).toEqual(['Amount Supplied / Owed (NGN) or Amount Paid (NGN)'])
    expect(readDebtTable([['Amount'], ['5']], 'owes_us').missing).toEqual(['Customer'])
    expect(() => readDebtTable([['Customer', 'Amount']], 'owes_us')).toThrow(/no rows/)
  })

  it('checks each cell; a row is a debt (amount owed) or a payment (amount paid only)', () => {
    const { payload, problems } = prepareDebtRows([
      { rowNumber: 2, cells: { party: ' Ada ', amount: '₦15,000', paid: '5,000', date: '02/10/2026', dueDate: '2026-11-30', method: 'cash', reference: 'INV-1' } },
      { rowNumber: 3, cells: { party: 'Ada', paid: '4000' } },
      { rowNumber: 4, cells: { party: '', amount: '5' } },
      { rowNumber: 5, cells: { party: 'B', amount: '100', paid: '200' } },
      { rowNumber: 6, cells: { party: 'C', amount: 'abc' } },
      { rowNumber: 7, cells: { party: 'D', amount: '10', date: '31/02/2026' } },
      { rowNumber: 8, cells: { party: 'E', amount: '10', method: 'Bitcoin' } },
      { rowNumber: 9, cells: { party: 'F' } },
      { rowNumber: 10, cells: { party: 'G', amount: '10', date: '2027-01-01' } },
    ], { today: '2026-11-14' })
    expect(payload).toEqual([
      { row: 2, party: 'Ada', phone: '', date: '2026-10-02', amount: 15000, paid: 5000, due_date: '2026-11-30', description: '', reference: 'INV-1', method: 'Cash' },
      { row: 3, party: 'Ada', phone: '', date: '', amount: 0, paid: 4000, due_date: '', description: '', reference: '', method: '' },
    ])
    expect(problems.map((p) => [p.row, p.message])).toEqual([
      [4, 'The name is missing.'],
      [5, 'Amount paid (200) is more than the amount owed (100).'],
      [6, 'Amount owed "abc" is not a valid amount.'],
      [7, 'Date "31/02/2026" is not a date (use YYYY-MM-DD or DD/MM/YYYY).'],
      [8, 'Payment method "Bitcoin" is not one of Cash, Transfer, POS, Cheque, Other.'],
      [9, 'Enter the amount owed, or the amount paid for a payment.'],
      [10, 'Date 2027-01-01 is in the future.'],
    ])
  })

  it('merges the database answer with the format problems in file order', () => {
    const m = mergeImportResult({ summary: { rows: 2, debts: 1, payments: 1, errors: 0 }, rows: [{ row: 5, status: 'ok' }, { row: 2, status: 'ok' }] }, [{ row: 3, party: 'X', message: 'bad' }])
    expect(m.rows.map((r) => r.row)).toEqual([2, 3, 5])
    expect(m.summary).toMatchObject({ rows: 3, errors: 1, debts: 1 })
  })

  it('the CSV template has the headers and examples of the direction', () => {
    const csv = buildDebtTemplateCsv('we_owe')
    expect(csv.split('\r\n')[0]).toBe('﻿' + DEBT_IMPORT.we_owe.columns.map((c) => c.header).join(','))
    expect(csv).toContain('Emzor Distributors')
  })
})

describe('exporting debts', () => {
  it('one row per debt in the import columns, with a reference the import recognises', () => {
    const d = { id: '1a2b3c4d-0000-4000-8000-000000000000', party_name: 'Ada', client_id: 'c1', amount: 900, amount_paid: 400, balance: 500, due_date: '2026-12-01', description: 'Tab', source: null, created_at: '2026-10-02T09:00:00' }
    expect(debtRef(d)).toBe('D-1A2B3C4D')
    expect(debtExportRows([d], { clientsById: new Map([['c1', { phone: '0803' }]]), statusLabel: () => 'Partially paid' })).toEqual([{
      party: 'Ada', phone: '0803', date: '2026-10-02', amount: 900, paid: 400, dueDate: '2026-12-01', description: 'Tab', reference: 'D-1A2B3C4D',
      balance: 500, status: 'Partially paid', source: 'Recorded by hand', linked: 'Yes',
    }])
    expect(debtExportColumns('we_owe').map((c) => c.key)).not.toContain('phone')
  })
})
