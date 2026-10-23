import { describe, it, expect } from 'vitest'
import { getTemplatesForBusinessType } from '../roleTemplates'
import { getNavItems, canSeeAllActivity, buildCustomPerms } from '../permissions'

// The field roles a manufacturer or wholesaler can start from (field team reorganisation design).
const byName = (type) => Object.fromEntries(getTemplatesForBusinessType(type).map((t) => [t.name, t.permissions]))

describe('field role templates', () => {
  it.each(['manufacturer_importer', 'wholesale'])('%s offers Field Rep and Field Manager, and no longer the old Sales Representative', (type) => {
    const t = byName(type)
    expect(t['Field Rep']).toBeTruthy()
    expect(t['Field Manager']).toBeTruthy()
    expect(t['Sales Representative']).toBeUndefined()
  })

  it('Field Rep is exactly Field, Orders, Messages, with no other powers', () => {
    const p = byName('manufacturer_importer')['Field Rep']
    expect(p.nav).toEqual(['activity', 'orders', 'messages'])
    for (const [k, v] of Object.entries(p)) if (k !== 'nav') expect(v).toBe(false)
  })

  it('a role made from Field Rep sees exactly that menu and no Field team pages', () => {
    const custom = { 'Field Rep': byName('manufacturer_importer')['Field Rep'] }
    expect(getNavItems('Field Rep', 'manufacturer_importer', custom).map((i) => i[0])).toEqual(['activity', 'orders', 'messages'])
  })

  it('Field Manager can manage the field team and reaches the Field team pages', () => {
    const p = byName('wholesale')['Field Manager']
    expect(p.canManageDirectory).toBe(true)
    expect(p.canViewReports).toBe(true)
    expect(p.nav).toEqual(['dashboard', 'activity', 'orders', 'messages', 'territories'])
    expect(canSeeAllActivity({ role: 'Field Manager', perms: buildCustomPerms(p) })).toBe(true)
    const ids = getNavItems('Field Manager', 'wholesale', { 'Field Manager': p }).map((i) => i[0])
    for (const id of ['field-reports', 'field-checkins', 'field-approvals', 'field-places']) expect(ids).toContain(id)
    expect(ids).not.toContain('field-fields')
  })

  it('the existing Regional Manager and Warehouse Operator templates are unchanged', () => {
    const t = byName('manufacturer_importer')
    expect(t['Regional Manager'].nav).toEqual(['dashboard', 'orders', 'warehouses', 'stock', 'territories', 'reports', 'adr-reports'])
    expect(t['Warehouse Operator'].nav).toEqual(['dashboard', 'warehouses', 'stock', 'orders'])
  })

  it('a pharmacy is offered no field roles (out of scope)', () => {
    const names = getTemplatesForBusinessType('pharmacy').map((t) => t.name)
    expect(names).not.toContain('Field Rep')
    expect(names).not.toContain('Field Manager')
  })
})
