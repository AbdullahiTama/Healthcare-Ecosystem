import { describe, it, expect } from 'vitest'
import {
  ROLES,
  DEFAULT_STAFF_PERMS,
  buildCustomPerms,
  getPerms,
  can,
  getNavItems,
  ROLE_LIST,
} from '../permissions.js'

describe('permissions role matrix', () => {
  it('grants the Owner full access', () => {
    const perms = getPerms('Owner')
    expect(perms.canEditPrice).toBe(true)
    expect(perms.canEditStock).toBe(true)
    expect(perms.canDelete).toBe(true)
    expect(perms.canViewFinance).toBe(true)
    expect(perms.canManageStaff).toBe(true)
    expect(perms.canMakeSales).toBe(true)
    expect(perms.canViewReports).toBe(true)
    expect(perms.canViewSettings).toBe(true)
  })

  it('restricts a Pharmacist to safe, sales-focused permissions', () => {
    const perms = getPerms('Pharmacist')
    expect(perms.canMakeSales).toBe(true)
    expect(perms.canEditPrice).toBe(false)
    expect(perms.canEditStock).toBe(false)
    expect(perms.canDelete).toBe(false)
    expect(perms.canViewFinance).toBe(false)
    expect(perms.canManageStaff).toBe(false)
    expect(perms.nav).toEqual(['dashboard', 'pos', 'inventory', 'clients', 'consultation', 'rx_inbox'])
  })

  it('gives Receptionist no sales or finance rights', () => {
    const perms = getPerms('Receptionist')
    expect(perms.canMakeSales).toBe(false)
    expect(perms.canViewFinance).toBe(false)
    expect(perms.nav).toEqual(['dashboard', 'clients', 'appointments', 'reception'])
  })

  it('falls back to safe defaults for any unknown role name', () => {
    // Manufacturer/Importer/Wholesale type their own custom titles.
    const perms = getPerms('Regional Manager')
    expect(perms).toEqual(DEFAULT_STAFF_PERMS)
    expect(perms.canManageStaff).toBe(false)
    expect(perms.canEditPrice).toBe(false)
    expect(perms.canMakeSales).toBe(false)
  })

  it('lists every role the app supports', () => {
    expect(ROLE_LIST).toEqual([
      'Owner', 'Manager', 'Pharmacist', 'Therapist', 'Receptionist',
      'Cashier', 'Nurse', 'Doctor', 'Lab Technician',
    ])
  })

  it('ROLES defines a permission set for every listed role', () => {
    for (const role of ROLE_LIST) {
      expect(ROLES[role], `${role} should have a preset`).toBeDefined()
      expect(ROLES[role].nav.length).toBeGreaterThan(0)
    }
  })
})

describe('custom roles (the `roles` table)', () => {
  it('never over-grants on a partial custom role: unspecified flags default to false', () => {
    const perms = buildCustomPerms({ nav: ['pos'] })
    expect(perms.nav).toEqual(['pos'])
    expect(perms.canEditPrice).toBe(false)
    expect(perms.canEditStock).toBe(false)
    expect(perms.canDelete).toBe(false)
    expect(perms.canViewReports).toBe(false)
    expect(perms.canExportReports).toBe(false)
    expect(perms.canManageStaff).toBe(false)
    expect(perms.canViewFinance).toBe(false)
    expect(perms.canMakeSales).toBe(false)
    expect(perms.canViewSettings).toBe(false)
  })

  it('grants exactly the flags set to true and nothing else', () => {
    const perms = buildCustomPerms({ canMakeSales: true, canViewFinance: false })
    expect(perms.canMakeSales).toBe(true)
    expect(perms.canViewFinance).toBe(false)
    expect(perms.canEditPrice).toBe(false)
    expect(perms.canEditStock).toBe(false)
    expect(perms.canDelete).toBe(false)
    expect(perms.canExportReports).toBe(false)
  })

  it('labels an unnamed custom role generically', () => {
    expect(buildCustomPerms({}).label).toBe('Custom Role')
  })

  it('prefers customRoles over preset roles by name', () => {
    const customRoles = { Manager: { canViewFinance: false } }
    const perms = getPerms('Manager', customRoles)
    expect(perms.canViewFinance).toBe(false)
  })

  it('uses the predefined nav list when a custom role specifies no nav', () => {
    const customRoles = { Owner: { canMakeSales: true } }
    expect(getPerms('Owner', customRoles).nav).toEqual(DEFAULT_STAFF_PERMS.nav)
  })

  it('can() reads a single permission for a role', () => {
    expect(can('Owner', 'canManageStaff')).toBe(true)
    expect(can('Cashier', 'canManageStaff')).toBe(false)
    expect(can('Regional Manager', 'canViewReports')).toBe(true) // DEFAULT_STAFF_PERMS
  })
})

describe('getNavItems by business type', () => {
  it('hides consultation for every business type except skincare and pharmacy', () => {
    const nav = (type) => getNavItems('Owner', type).map(([id]) => id)
    expect(nav('skincare')).toContain('consultation')
    expect(nav('pharmacy')).toContain('consultation')
    expect(nav('hospital')).not.toContain('consultation')
    expect(nav('manufacturer_importer')).not.toContain('consultation')
    expect(nav('wholesale')).not.toContain('consultation')
    expect(nav('dental')).not.toContain('consultation')
  })

  it('filters the business nav by the role’s allowed routes', () => {
    const nav = getNavItems('Pharmacist', 'hospital').map(([id]) => id)
    expect(nav).toContain('pos')
    expect(nav).not.toContain('reports')
    expect(nav).not.toContain('staff')
    expect(nav).not.toContain('settings')
  })

  it('uses the hospital nav for hospitals', () => {
    const nav = getNavItems('Owner', 'hospital').map(([id]) => id)
    expect(nav).toContain('doctor')
    expect(nav).toContain('lab')
    expect(nav).toContain('reception')
    expect(nav).toContain('triage')
  })

  it('uses the enterprise nav for manufacturer/importer and wholesale', () => {
    for (const type of ['manufacturer_importer', 'wholesale']) {
      const nav = getNavItems('Owner', type).map(([id]) => id)
      expect(nav).toContain('warehouses')
      expect(nav).toContain('territories')
      expect(nav).toContain('orders')
      expect(nav).toContain('stock')
      expect(nav).not.toContain('dashboards')
    }
  })
})