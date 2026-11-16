import { describe, it, expect, vi } from 'vitest'
import { parseBalanceType, readOpening, readClientTable, prepareClientImport, openingDebt, recordOpeningBalances, commitClientImport, buildClientTemplateCsv } from './clientImport'

const today = '2026-11-16'
const rows = (...r) => readClientTable([['Client Name', 'Phone Number', 'Opening Balance', 'Balance Type', 'Opening Balance Date'], ...r]).rows

describe('opening balances', () => {
  it('reads the balance type in the words people use', () => {
    for (const t of ['Client Owes Us', 'owes us', 'Receivable', 'DR', 'debit']) expect(parseBalanceType(t)).toBe('owes_us')
    for (const t of ['We Owe Client', 'we owe', 'Credit', 'CR', 'advance', 'Deposit']) expect(parseBalanceType(t)).toBe('we_owe')
    expect(parseBalanceType('')).toBe('')
    expect(parseBalanceType('maybe')).toBeNull()
  })

  it('needs an amount, a type and a date that is not in the future', () => {
    expect(readOpening({ amount: '₦15,000.50', type: 'Client Owes Us', date: '31/10/2026' }, { today })).toEqual({ opening: { direction: 'owes_us', amount: 15000.5, date: '2026-10-31' }, error: '', note: '' })
    expect(readOpening({ amount: '', type: '', date: '' }, { today })).toEqual({ opening: null, error: '', note: '' })
    expect(readOpening({ amount: '0', type: 'We Owe Client', date: '' }, { today }).note).toMatch(/without an opening balance amount/)
    expect(readOpening({ amount: '-500', type: 'Client Owes Us', date: '2026-10-01' }, { today }).error).toMatch(/not an amount/)
    expect(readOpening({ amount: 'abc', type: 'Client Owes Us', date: '2026-10-01' }, { today }).error).toMatch(/not an amount/)
    expect(readOpening({ amount: '500', type: '', date: '2026-10-01' }, { today }).error).toMatch(/Choose the Balance Type/)
    expect(readOpening({ amount: '500', type: 'We Owe Client', date: '' }, { today }).error).toMatch(/Enter the Opening Balance Date/)
    expect(readOpening({ amount: '500', type: 'We Owe Client', date: '2026-13-01' }, { today }).error).toMatch(/not a date/)
    expect(readOpening({ amount: '500', type: 'We Owe Client', date: '2026-12-01' }, { today }).error).toMatch(/in the future/)
  })

  it('is recorded as a hand-recorded debt linked to the client, dated on the opening date', () => {
    expect(openingDebt({ id: 'c1', full_name: 'Ada' }, { direction: 'we_owe', amount: 500, date: '2026-10-31' })).toEqual({
      direction: 'we_owe', party_name: 'Ada', client_id: 'c1', amount: 500, amount_paid: 0, balance: 500, status: 'pending',
      description: 'Opening balance', source: 'manual', source_ref: 'opening_balance', due_date: '', created_at: '2026-10-31',
    })
  })

  it('reports a client who already has one, and other failures, without stopping', async () => {
    const debtRepo = { create: vi.fn(async (_b, d) => {
      if (d.client_id === 'c2') throw new Error('duplicate key value violates unique constraint "debts_one_opening_balance_per_client"')
      if (d.client_id === 'c3') throw new Error('Failed to fetch')
      return [{}]
    }) }
    const o = { direction: 'owes_us', amount: 1, date: today }
    const r = await recordOpeningBalances('b1', [{ client: { id: 'c1', full_name: 'A' }, opening: o }, { client: { id: 'c2', full_name: 'B' }, opening: o }, { client: { id: 'c3', full_name: 'C' }, opening: o }], { debtRepo })
    expect(r).toEqual({ recorded: ['A'], already: ['B'], failed: [{ name: 'C', message: 'Failed to fetch' }] })
  })
})

describe('client rows', () => {
  it('requires name and phone, checks email, gender and date of birth, and matches phones by digits', () => {
    const t = readClientTable([
      ['Name', 'Mobile', 'Email', 'Sex', 'DOB'],
      ['Ada', '+234 801 234 5678', 'a@b.co', 'f', '12/05/1990'],
      ['', '0802', '', '', ''],
      ['Ben', '0803 333 4444', 'nope', 'x', '2030-01-01'],
      ['Chi', '0803-111-2222', '', '', ''],
    ])
    const { items, summary } = prepareClientImport(t.rows, { clients: [{ id: 'c9', full_name: 'Chi E', phone: '08031112222' }], today })
    expect(items[0]).toMatchObject({ status: 'new', record: { full_name: 'Ada', gender: 'Female', date_of_birth: '1990-05-12' } })
    expect(items[1].message).toMatch(/name is missing.*not a phone number/)
    expect(items[2].message).toMatch(/not an email.*Gender "x".*in the future/)
    expect(items[3]).toMatchObject({ status: 'exists', clientId: 'c9', name: 'Chi E' })
    expect(summary).toMatchObject({ rows: 4, new: 1, exists: 1, errors: 2, openings: 0 })
  })

  it('totals the opening balances in each direction', () => {
    const { summary } = prepareClientImport(rows(['A', '08011111111', '1000', 'Client Owes Us', '2026-10-01'], ['B', '08022222222', '250.5', 'We Owe Client', '2026-10-01'], ['C', '08033333333', '500', 'owes us', '2026-10-02']), { today })
    expect(summary).toMatchObject({ openings: 3, owesUs: 1500, weOwe: 250.5 })
  })

  it('the CSV template has the required columns first', () => {
    expect(buildClientTemplateCsv().replace('﻿', '').split('\r\n')[0]).toBe('Client Name,Phone Number,Address,Opening Balance,Balance Type,Opening Balance Date,Email,Gender,Date of Birth,Notes')
  })
})

describe('commitClientImport', () => {
  it('records no opening balance for a client the database skipped as added meanwhile', async () => {
    const { items } = prepareClientImport(rows(['A', '08011111111', '1000', 'Client Owes Us', '2026-10-01'], ['B', '08022222222', '500', 'We Owe Client', '2026-10-01']), { today })
    const createMany = vi.fn(async () => ({ added: 1, skipped: 1, failed: [], created: [{ id: 'n1', full_name: 'A', phone: '08011111111' }] }))
    const debtRepo = { create: vi.fn(async () => [{}]) }
    const r = await commitClientImport('b1', items, { createMany, debtRepo })
    expect(debtRepo.create).toHaveBeenCalledTimes(1)
    expect(debtRepo.create.mock.calls[0][1]).toMatchObject({ client_id: 'n1', amount: 1000 })
    expect(r).toMatchObject({ added: 1, skipped: 1, openings: { recorded: ['A'], already: [], failed: [] } })
  })
})
