import { describe, it, expect } from 'vitest'
import { getNavItems, getNavGroups, landingRoute, isRoleGrantable, MODULES, DEFAULT_STAFF_PERMS } from '../permissions'

// Field team reorganisation (docs/superpowers/specs/2026-10-23-field-team-reorganisation-design.md):
// reps get a focused Field login; field managers get a Field team section that is decided by the field-manager
// rule, never by a role's nav list.
const ids = (role, type, custom) => getNavItems(role, type, custom).map((i) => i[0])
const FIELD_TEAM = ['field-reports', 'field-checkins', 'field-approvals', 'field-places']

describe('the rep login', () => {
  it('an unrecognised, non-manager role at a manufacturer gets exactly Field, Orders, Messages', () => {
    expect(ids('Medical sales rep', 'manufacturer_importer')).toEqual(['activity', 'orders', 'messages'])
  })

  it('the same holds for a wholesaler', () => {
    expect(ids('Sales Rep', 'wholesale')).toEqual(['activity', 'orders', 'messages'])
  })

  it('an unrecognised MANAGER role keeps today\'s menu and gains the Field team section, not Report fields', () => {
    const got = ids('Regional Manager', 'wholesale')
    for (const id of ['warehouses', 'territories', 'messages', 'stock', 'orders', 'activity']) expect(got).toContain(id)
    for (const id of FIELD_TEAM) expect(got).toContain(id)
    expect(got).not.toContain('field-fields')
  })

  it('other business types keep today\'s fallback unchanged', () => {
    const before = DEFAULT_STAFF_PERMS.nav
    expect(before).toContain('warehouses') // the shared fallback itself is not edited
    expect(ids('Helper', 'pharmacy')).toEqual(getNavItems('Helper', 'pharmacy').map((i) => i[0]))
    expect(ids('Helper', 'pharmacy')).not.toContain('activity')
  })

  it('the rep\'s Field module is the existing activity key, relabelled and in its own section', () => {
    expect(MODULES.activity.label).toBe('Field')
    expect(MODULES.activity.section).toBe('field')
    const label = getNavItems('Medical sales rep', 'manufacturer_importer').find((i) => i[0] === 'activity')[2]
    expect(label).toBe('Field')
  })
})

describe('the Field team section', () => {
  it('the owner of a manufacturer gets every Field team page, including Report fields', () => {
    const got = ids('Owner', 'manufacturer_importer')
    for (const id of [...FIELD_TEAM, 'field-fields']) expect(got).toContain(id)
  })

  it('a custom role granted "Manage field team" (canManageDirectory) gets the four manager pages', () => {
    const custom = { 'Area Lead': { nav: ['activity'], canManageDirectory: true } }
    const got = ids('Area Lead', 'manufacturer_importer', custom)
    for (const id of FIELD_TEAM) expect(got).toContain(id)
    expect(got).not.toContain('field-fields')
  })

  it('a custom role WITHOUT the permission gets none, even if its stored nav lists them', () => {
    const custom = { 'Rep Plus': { nav: ['activity', 'field-reports', 'field-fields'] } }
    const got = ids('Rep Plus', 'manufacturer_importer', custom)
    expect(got).toContain('activity')
    for (const id of [...FIELD_TEAM, 'field-fields']) expect(got).not.toContain(id)
  })

  it('no Field team page and no Field for a pharmacy owner (out of scope)', () => {
    const got = ids('Owner', 'pharmacy')
    expect(got).not.toContain('activity')
    for (const id of [...FIELD_TEAM, 'field-fields']) expect(got).not.toContain(id)
  })

  it('the sidebar groups them under "Field team", after Field', () => {
    const groups = getNavGroups('Owner', 'manufacturer_importer')
    const order = groups.map((g) => g.id)
    expect(order.indexOf('field')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('field-team')).toBe(order.indexOf('field') + 1)
    const team = groups.find((g) => g.id === 'field-team')
    expect(team.label).toBe('Field team')
    expect(team.items.map((i) => i[0])).toEqual(['field-reports', 'field-checkins', 'field-approvals', 'field-places', 'field-fields'])
  })

  it('each Field team page deep-links under /dashboard/field-team/', () => {
    expect(MODULES['field-reports'].path).toBe('/dashboard/field-team/reports')
    expect(MODULES['field-checkins'].path).toBe('/dashboard/field-team/checkins')
    expect(MODULES['field-approvals'].path).toBe('/dashboard/field-team/approvals')
    expect(MODULES['field-places'].path).toBe('/dashboard/field-team/places')
    expect(MODULES['field-fields'].path).toBe('/dashboard/field-team/fields')
  })

  it('the Roles editor never offers the Field team pages as switches', () => {
    for (const id of [...FIELD_TEAM, 'field-fields']) expect(isRoleGrantable(id)).toBe(false)
    expect(isRoleGrantable('activity')).toBe(true)
    expect(isRoleGrantable('orders')).toBe(true)
  })
})

describe('landingRoute', () => {
  it('lands on the dashboard when it is allowed', () => {
    expect(landingRoute(['dashboard', 'activity'])).toBe('dashboard')
  })
  it('a rep without the dashboard lands on Field', () => {
    expect(landingRoute(['activity', 'orders', 'messages'])).toBe('activity')
  })
  it('otherwise the first allowed page, and dashboard when nothing is allowed', () => {
    expect(landingRoute(['orders'])).toBe('orders')
    expect(landingRoute([])).toBe('dashboard')
  })
})
