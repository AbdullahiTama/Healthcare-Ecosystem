import { describe, it, expect } from 'vitest'
import {
  readSupplierTable, prepareSupplierImport, mergeSuppliers, supplierFormChanges, validateSupplierForm, buildSupplierTemplateCsv,
  SUPPLIER_FIELDS, MAX_SUPPLIER_IMPORT_ROWS,
} from './supplierDirectory'
import { filterAccounts } from './supplierAccounts'

const H = ['Supplier Name *', 'Contact Person', 'Phone Number', 'Email', 'Address', 'Notes']
const table = (...rows) => readSupplierTable([H, ...rows]).rows
const emzor = { id: 's1', name: 'Emzor Distributors', supplier_key: 'emzor distributors', contact_person: '', phone: '0803 111 2222', email: '', address: '', notes: '' }
const account = (name, extra = {}) => ({ key: name.trim().toLowerCase(), name, purchases: 2, supplies: 0, supplied: 1000, paid: 400, balance: 600, open: 1, mismatches: 0, lastSupply: '2026-11-01', ...extra })

describe('supplier list template and file', () => {
  it('the CSV template has every column in order and two example rows', () => {
    const lines = buildSupplierTemplateCsv().replace('﻿', '').trim().split('\r\n')
    expect(lines[0]).toBe(SUPPLIER_FIELDS.map((f) => f.header).join(','))
    expect(lines).toHaveLength(3)
  })

  it('reads columns in any order and by common alternative names, and lists unknown ones', () => {
    const t = readSupplierTable([['Phone', 'Vendor', 'Fax'], ['0801', 'Fidson', 'x']])
    expect(t.missing).toEqual([])
    expect(t.ignored).toEqual(['Fax'])
    expect(t.rows).toEqual([{ rowNumber: 2, cells: { phone: '0801', name: 'Fidson' } }])
  })

  it('reports a missing name column, an empty file and too many rows', () => {
    expect(readSupplierTable([['Phone'], ['0801']]).missing).toEqual(['Supplier Name'])
    expect(() => readSupplierTable([[''], []])).toThrow('The file is empty.')
    expect(() => readSupplierTable([H])).toThrow('headers but no rows')
    expect(() => readSupplierTable([H, ...Array.from({ length: MAX_SUPPLIER_IMPORT_ROWS + 1 }, (_, i) => ['S' + i])])).toThrow(/limit is 2,000/)
  })
})

describe('prepareSupplierImport', () => {
  it('marks new, already listed, repeated and invalid rows, and counts what needs attention', () => {
    const { items, summary } = prepareSupplierImport(table(
      ['  Fidson   Healthcare ', 'Ada', '0809 555 0101', 'ada@fidson.example', 'Ikeja', ''],
      ['EMZOR distributors', '', '', '', '', ''],
      ['fidson healthcare', '', '0800 123 4567', '', '', ''],
      ['', '', '0801', '', '', ''],
      ['Bad Phone Ltd', '', 'call me', '', '', ''],
      ['Bad Email Ltd', '', '', 'not-an-email', '', ''],
    ), { directory: [emzor] })
    expect(items.map((i) => [i.row, i.status])).toEqual([[2, 'new'], [3, 'exists'], [4, 'duplicate'], [5, 'error'], [6, 'error'], [7, 'error']])
    expect(items[0].record).toEqual({ name: 'Fidson Healthcare', contact_person: 'Ada', phone: '0809 555 0101', email: 'ada@fidson.example', address: 'Ikeja', notes: '' })
    expect(items[1].name).toBe('Emzor Distributors')
    expect(items[2].message).toMatch(/Same supplier as row 2/)
    expect(items[3].message).toMatch(/name is missing/)
    expect(items[4].message).toMatch(/not a phone number/)
    expect(items[5].message).toMatch(/not an email address/)
    expect(summary).toMatchObject({ rows: 6, new: 1, exists: 1, duplicate: 1, errors: 3, fill: 0, attention: 4 })
  })

  it('flags a supplier without phone or email as incomplete but still imports it', () => {
    const { items } = prepareSupplierImport(table(['May & Baker', 'Tunde', '', '', 'Lagos', '']))
    expect(items[0].status).toBe('new')
    expect(items[0].warnings).toEqual(['Incomplete: no phone number or email.'])
  })

  it('fills only blank details of an existing supplier, and only when asked', () => {
    const rows = table(['Emzor Distributors', 'Chidi', '0700 000 0000', 'sales@emzor.example', '', ''])
    const off = prepareSupplierImport(rows, { directory: [emzor] }).items[0]
    expect(off).toMatchObject({ status: 'exists', fillable: true })
    const on = prepareSupplierImport(rows, { directory: [emzor], fillExisting: true }).items[0]
    expect(on.status).toBe('fill')
    // The phone it already has is kept; the contact person and email it lacked are added.
    expect(on.fill).toEqual({ id: 's1', changes: { contact_person: 'Chidi', email: 'sales@emzor.example' } })
  })

  it('notes a supplier that already has purchases, and a near spelling of a known supplier', () => {
    const { items } = prepareSupplierImport(table(['Medsupply', '', '0801 234 5678', '', '', ''], ['Emzor Distributors Ltd', '', '0802 234 5678', '', '', '']), {
      directory: [emzor], accounts: [account('MedSupply')],
    })
    expect(items[0].warnings).toEqual(['Has purchases already: its account gets these contact details.'])
    expect(items[1].warnings[0]).toMatch(/Did you mean Emzor Distributors\?/)
  })

  it('refuses a value longer than the database allows', () => {
    const { items } = prepareSupplierImport(table(['A'.repeat(201)]))
    expect(items[0].message).toMatch(/Supplier Name is too long/)
  })
})

describe('mergeSuppliers and search', () => {
  it('adds contact details to accounts and lists suppliers with nothing supplied yet', () => {
    const merged = mergeSuppliers([account('Emzor Distributors'), account('PharmaCo')], [emzor, { id: 's2', name: 'Fidson', supplier_key: 'fidson', phone: '0809' }])
    expect(merged.map((m) => [m.name, m.phone, m.balance, !!m.record])).toEqual([
      ['Emzor Distributors', '0803 111 2222', 600, true],
      ['PharmaCo', '', 600, false],
      ['Fidson', '0809', 0, true],
    ])
  })

  it('search finds a supplier by phone or contact person, not only by name', () => {
    const merged = mergeSuppliers([account('Emzor Distributors')], [{ ...emzor, contact_person: 'Chidi Okeke' }])
    expect(filterAccounts(merged, { query: '0803 111' })).toHaveLength(1)
    expect(filterAccounts(merged, { query: 'chidi' })).toHaveLength(1)
    expect(filterAccounts(merged, { query: 'nobody' })).toHaveLength(0)
  })
})

describe('supplier form', () => {
  it('a new supplier saves its name and every detail; an edit saves only what changed', () => {
    expect(supplierFormChanges(null, { name: ' New  Co ', phone: '0801', contact_person: '', email: '', address: '', notes: '' }))
      .toEqual({ name: 'New Co', phone: '0801', contact_person: '', email: '', address: '', notes: '' })
    expect(supplierFormChanges(emzor, { ...emzor, name: 'Emzor Distributors', email: ' a@b.co ' })).toEqual({ email: 'a@b.co' })
  })

  it('allows a name fixed in capitals only, and checks phone and email', () => {
    expect(validateSupplierForm({ name: 'EMZOR distributors' }, emzor)).toBe('')
    expect(validateSupplierForm({ name: 'Emzor Pharma' }, emzor)).toMatch(/capitals or spacing/)
    expect(validateSupplierForm({ name: '' })).toBe('Enter the supplier name.')
    expect(validateSupplierForm({ name: 'X', phone: 'abc' })).toMatch(/phone/)
    expect(validateSupplierForm({ name: 'X', email: 'abc' })).toMatch(/email/)
  })
})
