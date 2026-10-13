import { describe, it, expect } from 'vitest'
import { assignableCustomRoles, spaced, isSystemRole } from './roleNames'

describe('roleNames', () => {
  it('keeps only custom roles: not flagged, not one of the five, never super_admin, with an id and a name', () => {
    const rows = [
      { id: 1, name: 'moderator', is_system: true },
      { id: 2, name: 'Support Agent', is_system: false },
      { id: 3, name: 'Super Admin', is_system: false },
      { id: 4, name: 'content_lead', is_system: false },
      { id: null, name: 'no_id' },
      { id: 5 },
      null,
    ]
    expect(assignableCustomRoles(rows).map(r => r.id)).toEqual([4])
  })
  it('spaces underscores and dashes an empty name', () => {
    expect(spaced('content_lead')).toBe('content lead')
    expect(spaced('')).toBe('—')
  })
  it('knows system roles by flag, by name and by super_admin', () => {
    expect(isSystemRole({ name: 'x', is_system: true })).toBe(true)
    expect(isSystemRole({ name: 'Support Agent' })).toBe(true)
    expect(isSystemRole({ name: 'super admin' })).toBe(true)
    expect(isSystemRole({ name: 'content_lead' })).toBe(false)
  })
})
