import { describe, it, expect } from 'vitest'
import { clientEditForm, validateClientEdit, clientEditChanges, describeClientChanges, phoneDigits } from './clientEdit'

const ada = { id: 'c1', full_name: 'Ada Okafor', phone: '0803 111 2222', email: '', address: '12 Broad St', gender: 'Female', date_of_birth: '1990-05-12', notes: '', total_spend: 5000, visit_count: 3 }
const musa = { id: 'c2', full_name: 'Musa Bello', phone: '+234 809 555 0101' }
const today = '2026-11-16'
const form = (patch = {}) => ({ ...clientEditForm(ada), ...patch })

describe('Edit Client rules', () => {
  it('starts from the client and changes only what was edited, never visits or spend', () => {
    expect(clientEditForm(ada)).toEqual({ full_name: 'Ada Okafor', phone: '0803 111 2222', email: '', address: '12 Broad St', gender: 'Female', date_of_birth: '1990-05-12', notes: '', visit_count: '3', total_spend: '5000' })
    expect(clientEditChanges(ada, form())).toEqual({})
    expect(clientEditChanges(ada, form({ full_name: '  Ada   Okafor-Bello ', address: '4 Marina ' }))).toEqual({ full_name: 'Ada Okafor-Bello', address: '4 Marina' })
    expect(Object.keys(clientEditChanges(ada, { ...form(), total_spend: 0, visit_count: 0, business_id: 'x' }))).toEqual([])
  })

  it('accepts a valid edit', () => {
    expect(validateClientEdit(form({ phone: '0700 000 0000', email: 'ada@example.com' }), { client: ada, clients: [ada, musa], today })).toEqual({})
  })

  it('requires a name and a phone number', () => {
    const e = validateClientEdit(form({ full_name: '  ', phone: '' }), { client: ada, clients: [ada], today })
    expect(e.full_name).toMatch(/Enter the client's name/)
    expect(e.phone).toMatch(/Enter a phone number/)
  })

  it('refuses a phone number another client has, matched by digits like the database', () => {
    expect(phoneDigits('+234 809-555 0101')).toBe('2348095550101')
    expect(validateClientEdit(form({ phone: '+234 (809) 555-0101' }), { client: ada, clients: [ada, musa], today }).phone).toBe('Musa Bello already has this phone number.')
    // Its own number, written differently, is fine.
    expect(validateClientEdit(form({ phone: '0803-111-2222' }), { client: ada, clients: [ada, musa], today }).phone).toBeUndefined()
  })

  it('checks phone shape, email, date of birth, gender and lengths', () => {
    const e = validateClientEdit(form({ phone: 'call me', email: 'nope', date_of_birth: '2030-01-01', gender: 'X', address: 'a'.repeat(301) }), { client: ada, clients: [ada], today })
    expect(e).toEqual({
      phone: 'Enter a valid phone number (7 to 15 digits).', email: 'Enter a valid email address.', date_of_birth: 'The date of birth cannot be in the future.',
      gender: 'Choose Male, Female or Other.', address: 'Keep this under 300 characters.',
    })
    expect(validateClientEdit(form({ date_of_birth: '12/05/1990' }), { client: ada, today }).date_of_birth).toBe('Enter a valid date.')
  })

  it('describes the changes for the confirmation', () => {
    expect(describeClientChanges({ full_name: 'x' })).toBe('name')
    expect(describeClientChanges({ full_name: 'x', phone: 'y', address: 'z' })).toBe('name, phone number and address')
  })

  it('visits and total spent change only when allowed, and must be numbers of 0 or more', () => {
    const f = form({ visit_count: '4', total_spend: '5,250.5' })
    expect(clientEditChanges(ada, f)).toEqual({})
    expect(clientEditChanges(ada, f, { totals: true })).toEqual({ visit_count: 4, total_spend: 5250.5 })
    expect(clientEditChanges(ada, form(), { totals: true })).toEqual({})
    expect(validateClientEdit(form({ visit_count: '-1', total_spend: 'abc' }), { client: ada, clients: [ada], today, totals: true }))
      .toEqual({ visit_count: 'Enter a whole number of visits (0 or more).', total_spend: 'Enter an amount of 0 or more, in naira.' })
    expect(validateClientEdit(form({ visit_count: '-1' }), { client: ada, clients: [ada], today })).toEqual({})
    expect(describeClientChanges({ visit_count: 4, total_spend: 1 })).toBe('visits and total spent')
  })
})
