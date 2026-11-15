// Where a hand-entered or uploaded debt goes: the client record (owed to us) or the supplier account (we owe).
import { describe, it, expect } from 'vitest'
import { resolveDebtParty, describeParty, phoneKey, knownSuppliers } from './debtParty'

const clients = [
  { id: 'c1', full_name: 'Ada Obi', phone: '0803 123 4567' },
  { id: 'c2', full_name: 'Musa Bello', phone: '' },
  { id: 'c3', full_name: 'Musa Bello', phone: '+2348099999999' },
]
const suppliers = [{ key: 'emzor distributors', name: 'Emzor Distributors' }, { key: 'fidson ltd', name: 'Fidson Ltd' }]
const owed = (partyName, extra = {}) => resolveDebtParty({ direction: 'owes_us', partyName, ...extra }, { clients, suppliers })
const weOwe = (partyName) => resolveDebtParty({ direction: 'we_owe', partyName }, { clients, suppliers })

describe('resolveDebtParty: customers', () => {
  it('links to the one client of that name, whatever its capitals and spacing, under the saved spelling', () => {
    const r = owed('  ada   OBI ')
    expect(r).toMatchObject({ kind: 'client', name: 'Ada Obi' })
    expect(r.client.id).toBe('c1')
  })
  it('creates a client for a new name (keeping a usable phone), never for Walk-in', () => {
    expect(owed('Chidi Eze', { phone: '0812 000 1111' })).toEqual({ kind: 'new-client', name: 'Chidi Eze', phone: '0812 000 1111' })
    expect(owed('Chidi Eze', { phone: '12' })).toEqual({ kind: 'new-client', name: 'Chidi Eze', phone: '' })
    expect(owed('walk-in').kind).toBe('invalid')
  })
  it('never guesses between two clients of the same name: a phone or a pick decides', () => {
    const r = owed('Musa Bello')
    expect(r.kind).toBe('ambiguous')
    expect(r.choices.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(owed('Musa Bello', { phone: '08099999999' }).client.id).toBe('c3')
    expect(owed('Musa Bello', { clientId: 'c2' }).client.id).toBe('c2')
  })
  it('a phone that belongs to one client links to them, and says so when the name differs', () => {
    const r = owed('Mrs Obi', { phone: '+234 803 123 4567' })
    expect(r).toMatchObject({ kind: 'client', name: 'Ada Obi' })
    expect(r.note).toContain('belongs to Ada Obi')
  })
  it('a picked client whose name was then changed is not kept', () => {
    expect(owed('Someone Else', { clientId: 'c1' }).kind).toBe('new-client')
  })
  it('refuses a missing or overlong name and an unknown direction', () => {
    expect(owed('').kind).toBe('invalid')
    expect(owed('x'.repeat(201)).kind).toBe('invalid')
    expect(resolveDebtParty({ direction: 'sideways', partyName: 'Ada' }).kind).toBe('invalid')
  })
})

describe('resolveDebtParty: suppliers', () => {
  it('joins the existing supplier account under its saved spelling', () => {
    expect(weOwe('emzor distributors ')).toEqual({ kind: 'supplier', key: 'emzor distributors', name: 'Emzor Distributors' })
  })
  it('starts a new account for a new name, pointing out a likely duplicate', () => {
    expect(weOwe('Landlord')).toEqual({ kind: 'new-supplier', key: 'landlord', name: 'Landlord', similar: [] })
    expect(weOwe('Fidson Limited').similar).toEqual(['Fidson Ltd'])
  })
})

describe('describeParty and phoneKey', () => {
  it('says where the debt goes', () => {
    expect(describeParty(owed('Ada Obi'))).toBe('Linked to client Ada Obi')
    expect(describeParty(owed('New Person'))).toBe('New client record for New Person')
    expect(describeParty(weOwe('Emzor Distributors'))).toBe('Added to supplier Emzor Distributors')
    expect(describeParty(weOwe('Landlord'))).toBe('New supplier account for Landlord')
  })
  it('compares phone numbers by digits without +234 or 0', () => {
    expect(phoneKey('+234 803-123 4567')).toBe(phoneKey('08031234567'))
  })
})

describe('knownSuppliers', () => {
  it('adds suppliers known only from a hand-recorded "we owe" debt, once per key; purchase and customer debts are not suppliers', () => {
    const debts = [
      { direction: 'we_owe', party_name: ' Landlord Ltd', source: null },
      { direction: 'we_owe', party_name: 'landlord ltd', source: 'manual' },
      { direction: 'we_owe', party_name: 'EMZOR DISTRIBUTORS', source: null },
      { direction: 'we_owe', party_name: 'Via Purchase', source: 'purchase' },
      { direction: 'owes_us', party_name: 'Ada', source: null },
    ]
    expect(knownSuppliers(suppliers, debts)).toEqual([
      { key: 'emzor distributors', name: 'Emzor Distributors' }, { key: 'fidson ltd', name: 'Fidson Ltd' }, { key: 'landlord ltd', name: 'Landlord Ltd' },
    ])
  })
})
