import { describe, it, expect } from 'vitest'
import { EMPTY_CLIENT_BULK_EDIT, validateClientBulkEdit, planClientBulkEdit, appendNote } from './clientBulkEdit'

const C = [
  { id: 'a', full_name: 'Ada', gender: 'Female', address: '12 Broad St', notes: 'VIP' },
  { id: 'b', full_name: 'Musa', gender: '', address: null, notes: null },
]
const c = (patch) => ({ ...EMPTY_CLIENT_BULK_EDIT, ...patch })
const today = '2026-11-10'

describe('client bulk edit', () => {
  it('nothing filled in changes nothing; bad values are refused', () => {
    expect(validateClientBulkEdit(EMPTY_CLIENT_BULK_EDIT)).toEqual({ errors: {}, ok: true, hasChanges: false })
    expect(validateClientBulkEdit(c({ gender: 'Unknown' })).errors.gender).toMatch(/Male, Female or Other/)
    expect(validateClientBulkEdit(c({ note: 'x'.repeat(501) })).errors.note).toMatch(/under 500/)
    expect(planClientBulkEdit(C, c({ gender: 'Unknown' }), { today })).toEqual([])
  })

  it('sets gender and address only where they differ', () => {
    expect(planClientBulkEdit(C, c({ gender: 'Female', address: ' 12 Broad St ' }), { today })).toEqual([
      { id: 'b', name: 'Musa', updates: { gender: 'Female', address: '12 Broad St' }, before: { gender: null, address: null } },
    ])
  })

  it('adds a dated note to every client, keeping what was there', () => {
    const plan = planClientBulkEdit(C, c({ note: '  Called about   refill ' }), { today })
    expect(plan.map((p) => p.updates.notes)).toEqual(['VIP\n2026-11-10: Called about refill', '2026-11-10: Called about refill'])
  })

  it('notes never grow past 2,000 characters (the newest text is kept)', () => {
    const long = appendNote('x'.repeat(2500), 'latest', today)
    expect(long).toHaveLength(2000)
    expect(long.endsWith('2026-11-10: latest')).toBe(true)
  })
})
