// Recording one debt linked to its client or supplier, and linking older unlinked customer debts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./repositories', () => ({ debtRepository: {} }))
vi.mock('../clients/repositories', () => ({ clientRepository: {} }))

import { recordDebt, debtFigures, linkUnlinkedDebts, unlinkedClientDebts } from './recordDebt'

let debts, clientRepo, clients
beforeEach(() => {
  let n = 0
  debts = { create: vi.fn(async (_b, d) => [{ id: 'd' + (++n), ...d }]), update: vi.fn(async () => {}) }
  clientRepo = { create: vi.fn(async (_b, c) => [{ id: 'new-' + c.full_name, ...c }]) }
  clients = [{ id: 'c1', full_name: 'Ada Obi', phone: '' }]
})

describe('debtFigures', () => {
  it('works out the balance and status, with ₦ and commas accepted', () => {
    expect(debtFigures({ amount: '₦15,000', amountPaid: '5000' })).toEqual({ amount: 15000, paid: 5000, balance: 10000, status: 'pending' })
    expect(debtFigures({ amount: 200, amountPaid: 200 })).toEqual({ amount: 200, paid: 200, balance: 0, status: 'paid' })
    expect(debtFigures({ amount: 200, amountPaid: '' }).paid).toBe(0)
  })
  it('refuses a zero, negative or unreadable amount, and paying more than owed', () => {
    expect(debtFigures({ amount: 0 }).error).toBeTruthy()
    expect(debtFigures({ amount: 'abc' }).error).toBeTruthy()
    expect(debtFigures({ amount: 100, amountPaid: -1 }).error).toBeTruthy()
    expect(debtFigures({ amount: 100, amountPaid: 150 }).error).toContain('more than the amount')
  })
})

describe('recordDebt', () => {
  const ctx = () => ({ clients, suppliers: [{ key: 'emzor', name: 'Emzor' }], debts, clientRepo })

  it('links a customer debt to the existing client, without creating one', async () => {
    const r = await recordDebt('B1', { direction: 'owes_us', partyName: 'ada obi', amount: '5000', amountPaid: '1000', dueDate: '2026-12-01', description: ' Drugs ' }, ctx())
    expect(clientRepo.create).not.toHaveBeenCalled()
    expect(debts.create).toHaveBeenCalledWith('B1', {
      client_id: 'c1', direction: 'owes_us', party_name: 'Ada Obi', amount: 5000, amount_paid: 1000, balance: 4000,
      due_date: '2026-12-01', status: 'pending', description: 'Drugs',
    })
    expect(r.createdClient).toBeNull()
  })

  it('creates a missing client once, links the debt, and reuses that client for the next debt', async () => {
    const c = ctx()
    const first = await recordDebt('B1', { direction: 'owes_us', partyName: 'Chidi Eze', phone: '0812 000 1111', amount: 3000 }, c)
    expect(clientRepo.create).toHaveBeenCalledWith('B1', expect.objectContaining({ full_name: 'Chidi Eze', phone: '0812 000 1111' }))
    expect(first.createdClient.id).toBe('new-Chidi Eze')
    expect(debts.create.mock.calls[0][1].client_id).toBe('new-Chidi Eze')
    await recordDebt('B1', { direction: 'owes_us', partyName: 'CHIDI EZE', amount: 1000 }, c)
    expect(clientRepo.create).toHaveBeenCalledTimes(1)
    expect(debts.create.mock.calls[1][1]).toMatchObject({ client_id: 'new-Chidi Eze', party_name: 'Chidi Eze' })
  })

  it('saves a supplier debt under the supplier\'s spelling, with no client', async () => {
    await recordDebt('B1', { direction: 'we_owe', partyName: ' EMZOR ', amount: 9000 }, ctx())
    expect(debts.create.mock.calls[0][1]).toMatchObject({ client_id: null, party_name: 'Emzor', direction: 'we_owe', balance: 9000 })
    expect(clientRepo.create).not.toHaveBeenCalled()
  })

  it('saves nothing when the amount or party is wrong, or two clients share the name', async () => {
    clients.push({ id: 'c2', full_name: 'Ada Obi' })
    await expect(recordDebt('B1', { direction: 'owes_us', partyName: 'Ada Obi', amount: 100 }, ctx())).rejects.toThrow('2 clients are named Ada Obi')
    await expect(recordDebt('B1', { direction: 'owes_us', partyName: '', amount: 100 }, ctx())).rejects.toThrow('Party name is missing')
    await expect(recordDebt('B1', { direction: 'owes_us', partyName: 'X', amount: 0 }, ctx())).rejects.toThrow('above 0')
    expect(debts.create).not.toHaveBeenCalled()
    expect(clientRepo.create).not.toHaveBeenCalled()
  })

  it('explains a phone already used by another client', async () => {
    clientRepo.create.mockRejectedValue(new Error('Supabase error (409): duplicate key value violates unique constraint "clients_phone_key"'))
    await expect(recordDebt('B1', { direction: 'owes_us', partyName: 'New', phone: '08011112222', amount: 100 }, ctx())).rejects.toThrow('already exists')
    expect(debts.create).not.toHaveBeenCalled()
  })
})

describe('linking older customer debts', () => {
  const rows = [
    { id: 'd1', business_id: 'B1', direction: 'owes_us', party_name: 'ADA OBI', client_id: null, source: null },
    { id: 'd2', business_id: 'B1', direction: 'owes_us', party_name: 'Tunde', client_id: null, source: 'manual' },
    { id: 'd3', business_id: 'B1', direction: 'owes_us', party_name: 'tunde ', client_id: null, source: null },
    { id: 'd4', business_id: 'B1', direction: 'owes_us', party_name: 'Ben', client_id: null, source: 'credit_sale' },
    { id: 'd5', business_id: 'B1', direction: 'we_owe', party_name: 'Emzor', client_id: null, source: null },
    { id: 'd6', business_id: 'B2', direction: 'owes_us', party_name: 'Other branch', client_id: null, source: null },
    { id: 'd7', business_id: 'B1', direction: 'owes_us', party_name: 'Ada Obi', client_id: 'c1', source: null },
  ]
  it('lists only this location\'s hand-recorded customer debts without a client', () => {
    expect(unlinkedClientDebts(rows, 'B1').map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
  })
  it('links to existing clients and creates a missing one once', async () => {
    const r = await linkUnlinkedDebts('B1', unlinkedClientDebts(rows, 'B1'), { clients, debts, clientRepo })
    expect(r).toMatchObject({ linked: 3, created: 1, skipped: [] })
    expect(clientRepo.create).toHaveBeenCalledTimes(1)
    expect(debts.update.mock.calls).toEqual([
      ['d1', 'B1', { client_id: 'c1' }],
      ['d2', 'B1', { client_id: 'new-Tunde' }],
      ['d3', 'B1', { client_id: 'new-Tunde' }],
    ])
  })
  it('leaves a name shared by two clients, and a failed save, for the person', async () => {
    clients.push({ id: 'c2', full_name: 'Ada Obi' })
    debts.update.mockRejectedValueOnce(new Error('offline'))
    const r = await linkUnlinkedDebts('B1', [rows[0], rows[1]], { clients, debts, clientRepo })
    expect(r.linked).toBe(0)
    expect(r.skipped.map((s) => s.reason)).toEqual(['2 clients share this name', 'could not be saved'])
  })
})
