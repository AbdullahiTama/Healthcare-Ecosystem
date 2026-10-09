import { describe, it, expect } from 'vitest'
import {
  ROLES,
  DEFAULT_STAFF_PERMS,
  buildCustomPerms,
  getPerms,
  can,
  getNavItems,
  getModulesForType,
  rolesForType,
  isReservedRoleName,
  ALL_NAV_DEFAULT,
  ALL_NAV_HOSPITAL,
  ALL_NAV_ENTERPRISE,
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
    const customRoles = { 'Regional Manager': { canMakeSales: true } }
    expect(getPerms('Regional Manager', customRoles).nav).toEqual(DEFAULT_STAFF_PERMS.nav)
  })

  it('never lets a custom role named Owner narrow the business admin', () => {
    const customRoles = { Owner: { canMakeSales: false, canManageStaff: false, nav: ['dashboard'] } }
    const perms = getPerms('Owner', customRoles)
    expect(perms.canManageStaff).toBe(true)
    expect(perms.nav).toEqual(ROLES.Owner.nav)
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

describe('module registry (business type → modules)', () => {
  it('never offers another vertical\'s modules to a business type', () => {
    const ids = (type) => getModulesForType(type).map(([id]) => id)
    // Retail never sees hospital or enterprise modules.
    for (const type of ['skincare', 'pharmacy', 'dental', 'optical', 'wellness']) {
      expect(ids(type)).not.toContain('reception')
      expect(ids(type)).not.toContain('lab')
      expect(ids(type)).not.toContain('warehouses')
      expect(ids(type)).not.toContain('orders')
      expect(ids(type)).not.toContain('stock')
    }
    // Hospital never sees retail-only modules (appointments) or enterprise ones.
    expect(ids('hospital')).not.toContain('appointments')
    expect(ids('hospital')).not.toContain('warehouses')
    expect(ids('hospital')).not.toContain('orders')
    // Enterprise never sees retail-only or hospital modules — but it does get
    // the generic ALL_TYPES modules (pos, inventory, clients, expenses...), which
    // the registry gate allows for every vertical, even though the legacy
    // enterprise NAV_ORDER predates the registry and omitted them.
    for (const type of ['manufacturer_importer', 'wholesale']) {
      expect(ids(type)).not.toContain('appointments')
      expect(ids(type)).not.toContain('consultation')
      expect(ids(type)).not.toContain('doctor')
      expect(ids(type)).not.toContain('reception')
      expect(ids(type)).toContain('pos')
      expect(ids(type)).toContain('inventory')
      expect(ids(type)).toContain('clients')
    }
  })

  it('keeps consultation a skincare+pharmacy-only module', () => {
    const ids = (type) => getModulesForType(type).map(([id]) => id)
    expect(ids('skincare')).toContain('consultation')
    expect(ids('pharmacy')).toContain('consultation')
    expect(ids('dental')).not.toContain('consultation')
    expect(ids('hospital')).not.toContain('consultation')
  })

  it('labels clients as Patients for hospitals and Clients everywhere else', () => {
    const tuple = (type) => getModulesForType(type).find(([id]) => id === 'clients')
    expect(tuple('hospital')[2]).toBe('Patients')
    expect(tuple('pharmacy')[2]).toBe('Clients')
  })

  it('produces the same nav tuples the legacy exported lists carried', () => {
    // Spot-check that the derived exports still match the pre-registry shapes.
    expect(ALL_NAV_DEFAULT.length).toBe(17)
    expect(ALL_NAV_HOSPITAL.length).toBe(21)
    expect(ALL_NAV_ENTERPRISE.length).toBe(16) // 13 + Business Discovery + Business Directory + Territory Intelligence
    expect(ALL_NAV_DEFAULT[0]).toEqual(['overview', expect.anything(), 'Overview'])
    expect(ALL_NAV_DEFAULT[2]).toEqual(['pos', expect.anything(), 'POS / Sales'])
  })

  it('scopes preset roles offered to staff by business type', () => {
    expect(rolesForType('pharmacy')).not.toContain('Doctor')
    expect(rolesForType('pharmacy')).not.toContain('Lab Technician')
    expect(rolesForType('pharmacy')).not.toContain('Nurse')
    expect(rolesForType('pharmacy')).toContain('Pharmacist')
    expect(rolesForType('pharmacy')).toContain('Therapist')
    expect(rolesForType('hospital')).not.toContain('Pharmacist')
    expect(rolesForType('hospital')).not.toContain('Therapist')
    expect(rolesForType('hospital')).toContain('Doctor')
    expect(rolesForType('hospital')).toContain('Lab Technician')
    expect(rolesForType('wholesale')).toEqual([])
    expect(rolesForType('manufacturer_importer')).toEqual([])
  })

  it('never offers Owner as a staff role — the Owner is the business account', () => {
    for (const type of ['pharmacy', 'skincare', 'hospital', 'wholesale', 'manufacturer_importer']) {
      expect(rolesForType(type)).not.toContain('Owner')
    }
  })

  it('reserves the Owner name in any casing', () => {
    expect(isReservedRoleName('Owner')).toBe(true)
    expect(isReservedRoleName('  owner ')).toBe(true)
    expect(isReservedRoleName('OWNER')).toBe(true)
    expect(isReservedRoleName('Co-owner')).toBe(false)
    expect(isReservedRoleName('')).toBe(false)
    expect(isReservedRoleName(undefined)).toBe(false)
  })
})

describe('Business Discovery / Directory modules', () => {
  const nav = (role, type, custom) => getNavItems(role, type, custom).map(([id]) => id)

  it('are enterprise-only', () => {
    ;['discovery', 'directory'].forEach((m) => {
      expect(nav('Owner', 'manufacturer_importer')).toContain(m)
      expect(nav('Owner', 'wholesale')).toContain(m)
      expect(nav('Owner', 'pharmacy')).not.toContain(m)
      expect(nav('Owner', 'hospital')).not.toContain(m)
    })
  })

  it('Live Field Activity stays available alongside them', () => {
    expect(nav('Owner', 'manufacturer_importer')).toContain('activity')
  })

  it('reps and managers can search, but only the Owner manages the directory by default', () => {
    expect(nav('Manager', 'manufacturer_importer')).toContain('discovery')
    expect(nav('Manager', 'manufacturer_importer')).not.toContain('directory')
    expect(nav('Regional Rep', 'manufacturer_importer')).toContain('discovery')
    expect(nav('Regional Rep', 'manufacturer_importer')).not.toContain('directory')
    expect(getPerms('Owner').canManageDirectory).toBe(true)
    expect(getPerms('Manager').canManageDirectory).toBeFalsy()
    expect(getPerms('Regional Rep').canManageDirectory).toBe(false)
  })

  it('a custom role only manages the directory when the Owner says so', () => {
    expect(buildCustomPerms({ nav: ['directory'] }).canManageDirectory).toBe(false)
    expect(buildCustomPerms({ nav: ['directory'], canManageDirectory: true }).canManageDirectory).toBe(true)
  })
})

describe('Territory Intelligence module', () => {
  const nav = (role, type) => getNavItems(role, type).map(([id]) => id)
  it('is enterprise-only and available to Owner and Manager, not to a plain rep', () => {
    expect(nav('Owner', 'manufacturer_importer')).toContain('intelligence')
    expect(nav('Owner', 'wholesale')).toContain('intelligence')
    expect(nav('Owner', 'pharmacy')).not.toContain('intelligence')
    expect(nav('Manager', 'manufacturer_importer')).toContain('intelligence')
    expect(nav('Regional Rep', 'manufacturer_importer')).not.toContain('intelligence')
  })
})
