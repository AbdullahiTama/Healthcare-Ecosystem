import { describe, it, expect } from 'vitest'
import {
  ROLES,
  DEFAULT_STAFF_PERMS,
  buildCustomPerms,
  getPerms,
  can,
  getNavItems,
  getNavGroups,
  getModulesForType,
  rolesForType,
  ALL_NAV_DEFAULT,
  ALL_NAV_HOSPITAL,
  ALL_NAV_ENTERPRISE,
  ROLE_LIST,
  REPORT_TABS,
  REPORT_TAB_SLUGS,
  slugToReportTab,
  reportTabSlug,
  getReportTabs,
  getReportDefaultTab,
  modulePath,
  isModuleActive,
  isManagerRole,
} from '../permissions.js'
import { BUSINESS_TYPES } from '../../config/constants.js'

describe('isManagerRole', () => {
  it('matches the preset role and the custom titles real tenants type', () => {
    expect(isManagerRole('Manager')).toBe(true)
    expect(isManagerRole('Regional Manager')).toBe(true)
    expect(isManagerRole('Four sisters Manager')).toBe(true)
    expect(isManagerRole('Business Development manager')).toBe(true)
  })

  it('does not match non-manager roles or missing values', () => {
    expect(isManagerRole('Medical sales rep')).toBe(false)
    expect(isManagerRole('Pharmacist')).toBe(false)
    expect(isManagerRole('')).toBe(false)
    expect(isManagerRole(null)).toBe(false)
    expect(isManagerRole(undefined)).toBe(false)
  })

  it('does not cover the owner, who has no staff row', () => {
    expect(isManagerRole('Owner')).toBe(false)
  })
})

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
    expect(perms.nav).toEqual(['dashboard', 'pos', 'inventory', 'clients', 'consultation', 'rx_inbox', 'adr-reports'])
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
  it('grants consultation to the consultation-driven types only', () => {
    const nav = (type) => getNavItems('Owner', type).map(([id]) => id)
    for (const type of ['skincare', 'pharmacy', 'clinic', 'aesthetic', 'spa', 'haircare']) {
      expect(nav(type), `${type} should offer consultations`).toContain('consultation')
    }
    for (const type of ['hospital', 'laboratory', 'cosmetics', 'other', 'dental', 'manufacturer_importer', 'wholesale']) {
      expect(nav(type), `${type} should not offer consultations`).not.toContain('consultation')
    }
  })

  it('filters the business nav by the role’s allowed routes', () => {
    const nav = getNavItems('Pharmacist', 'hospital').map(([id]) => id)
    expect(nav).toContain('pos')
    expect(nav).toContain('adr-reports')
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

  it('keeps consultation scoped to the consultation family', () => {
    const ids = (type) => getModulesForType(type).map(([id]) => id)
    for (const type of ['skincare', 'pharmacy', 'clinic', 'aesthetic', 'spa', 'haircare']) {
      expect(ids(type), `${type} should have consultation`).toContain('consultation')
    }
    for (const type of ['dental', 'hospital', 'laboratory', 'cosmetics']) {
      expect(ids(type), `${type} should not have consultation`).not.toContain('consultation')
    }
  })

  it('labels clients as Patients at hospitals and clinics, Clients everywhere else', () => {
    const tuple = (type) => getModulesForType(type).find(([id]) => id === 'clients')
    expect(tuple('hospital')[2]).toBe('Patients')
    expect(tuple('clinic')[2]).toBe('Patients')
    expect(tuple('pharmacy')[2]).toBe('Clients')
    expect(tuple('laboratory')[2]).toBe('Clients')
  })

  it('produces the same nav tuples the legacy exported lists carried', () => {
    // Spot-check that the derived exports still match the pre-registry shapes.
    // Counts reflect wallet + mastercatalog + ecommerce being ALL_TYPES (added after initial registry) + discovery for enterprise + pv-tracker for enterprise.
    expect(ALL_NAV_DEFAULT.length).toBe(20)
    expect(ALL_NAV_HOSPITAL.length).toBe(24)
    expect(ALL_NAV_ENTERPRISE.length).toBe(21) // 18 + Business Discovery + Business Directory + Territory Intelligence
    expect(ALL_NAV_ENTERPRISE.map(([id]) => id)).toContain('pv-tracker')
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
})

describe('signup taxonomy (config/constants.js BUSINESS_TYPES)', () => {
  const ids = (type) => getModulesForType(type).map(([id]) => id)
  const ownerNav = (type) => getNavItems('Owner', type).map(([id]) => id)
  const CLINICAL = ['reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging']
  const ENTERPRISE = ['activity', 'discovery', 'business-discovery', 'directory', 'intelligence', 'orders', 'warehouses', 'stock', 'territories', 'messages', 'pv-tracker']

  it('resolves every registered signup type to a working owner nav', () => {
    for (const { id } of BUSINESS_TYPES) {
      expect(ids(id).length, `${id} should resolve modules`).toBeGreaterThan(0)
      expect(ownerNav(id), `${id} should reach the dashboard`).toContain('dashboard')
      expect(ownerNav(id), `${id} owner should reach the wallet`).toContain('wallet')
    }
  })

  it('never leaks clinical or enterprise modules into the signup taxonomy', () => {
    for (const { id } of BUSINESS_TYPES) {
      if (id === 'hospital') continue
      for (const moduleId of CLINICAL) {
        if (id === 'laboratory' && moduleId === 'lab') continue
        expect(ids(id), `${id} must not see ${moduleId}`).not.toContain(moduleId)
      }
      for (const moduleId of ENTERPRISE) {
        expect(ids(id), `${id} must not see ${moduleId}`).not.toContain(moduleId)
      }
    }
  })

  it('gives the appointment-driven types appointments and consultations', () => {
    for (const type of ['clinic', 'aesthetic', 'spa', 'haircare']) {
      expect(ids(type), `${type} should get appointments`).toContain('appointments')
      expect(ids(type), `${type} should get consultations`).toContain('consultation')
    }
    // cosmetics and other are commerce-first, not appointment-driven.
    for (const type of ['cosmetics', 'other']) {
      expect(ids(type)).not.toContain('appointments')
      expect(ids(type)).not.toContain('consultation')
      expect(ids(type)).toContain('pos')
      expect(ids(type)).toContain('inventory')
    }
  })

  it('gives laboratories the lab bench and nothing else clinical', () => {
    expect(ids('laboratory')).toContain('lab')
    for (const moduleId of ['reception', 'triage', 'doctor', 'rx_inbox', 'imaging', 'appointments', 'consultation']) {
      expect(ids('laboratory')).not.toContain(moduleId)
    }
    expect(ids('laboratory')).toContain('pos')
    expect(ids('laboratory')).toContain('inventory')
  })

  it('normalizes unknown and empty business types to the Other set', () => {
    const other = ids('other')
    for (const type of ['mystery_type', '', null, undefined]) {
      expect(ids(type), `${String(type)} should fall back to Other`).toEqual(other)
    }
  })

  it('scopes preset roles for the signup taxonomy', () => {
    expect(rolesForType('clinic')).toContain('Doctor')
    expect(rolesForType('clinic')).not.toContain('Pharmacist')
    expect(rolesForType('laboratory')).toContain('Lab Technician')
    expect(rolesForType('laboratory')).not.toContain('Doctor')
    expect(rolesForType('aesthetic')).toContain('Therapist')
    expect(rolesForType('aesthetic')).not.toContain('Pharmacist')
    expect(rolesForType('cosmetics')).not.toContain('Therapist')
    expect(rolesForType('')).toEqual(rolesForType('other'))
  })

  it('orders clinic and laboratory navs around their core workflow', () => {
    const clinic = ownerNav('clinic')
    expect(clinic.indexOf('appointments')).toBeLessThan(clinic.indexOf('pos'))
    const lab = ownerNav('laboratory')
    expect(lab.indexOf('lab')).toBeLessThan(lab.indexOf('pos'))
    const clinicSections = getNavGroups('Owner', 'clinic').map(g => g.id)
    expect(clinicSections).not.toContain('clinical')
  })
})

describe('getNavGroups (workflow sections)', () => {
  it('groups every allowed module into exactly one workflow section', () => {
    const groups = getNavGroups('Owner', 'hospital')
    const ids = groups.flatMap(g => g.items.map(([id]) => id))
    const flat = getNavItems('Owner', 'hospital').map(([id]) => id)
    // Same membership as the flat list — grouping may reorder by section but
    // must never add or drop items, and each module lands in exactly one group.
    expect([...ids].sort()).toEqual([...flat].sort())
    expect(new Set(ids).size).toBe(ids.length)
    expect(groups.every(g => g.label && g.items.length > 0)).toBe(true)
  })

  it('preserves section order and drops empty sections', () => {
    // Pharmacist at a pharmacy never has Finance/People/Admin/Clinical groups.
    const groups = getNavGroups('Pharmacist', 'pharmacy')
    const labels = groups.map(g => g.label)
    expect(labels[0]).toBe('Overview')
    expect(labels).not.toContain('Finance')
    expect(labels).not.toContain('People')
    expect(labels).not.toContain('Admin')
    expect(labels).not.toContain('Clinical')
  })

  it('puts hospital clinical modules in the Clinical section', () => {
    const groups = getNavGroups('Owner', 'hospital')
    const clinical = groups.find(g => g.id === 'clinical')
    expect(clinical).toBeTruthy()
    const ids = clinical.items.map(([id]) => id)
    expect(ids).toContain('reception')
    expect(ids).toContain('doctor')
    expect(ids).toContain('lab')
  })

  it('respects custom role nav restrictions', () => {
    // Owner is intentionally immune to custom-role narrowing (business admin),
    // so exercise the override through a non-Owner role instead.
    const groups = getNavGroups('Manager', 'pharmacy', { Manager: { nav: ['dashboard', 'pos'] } })
    const ids = groups.flatMap(g => g.items.map(([id]) => id))
    expect(ids).toEqual(['dashboard', 'pos'])
  })
})

describe('reports hub (EXPERIENCE.md §2 tab taxonomy)', () => {
  it('maps each canonical tab to a deep-linkable slug and back', () => {
    expect(REPORT_TABS).toEqual(['reports', 'adr-reports'])
    expect(REPORT_TAB_SLUGS).toEqual({ reports: 'financial', 'adr-reports': 'adr' })
    expect(reportTabSlug('reports')).toBe('financial')
    expect(slugToReportTab['financial']).toBe('reports')
    expect(slugToReportTab['adr']).toBe('adr-reports')
  })

  it('exposes only the tabs a role is granted, in canonical order', () => {
    expect(getReportTabs('Owner', 'pharmacy')).toEqual(['reports', 'adr-reports'])
    expect(getReportTabs('Manager', 'pharmacy')).toEqual(['reports', 'adr-reports'])
    // Pharmacist has ADR but not Financial Reports.
    expect(getReportTabs('Pharmacist', 'pharmacy')).toEqual(['adr-reports'])
    expect(getReportTabs('Nurse', 'hospital')).toEqual(['adr-reports'])
    // Receptionist has no report modules at all.
    expect(getReportTabs('Receptionist', 'hospital')).toEqual([])
  })

  it('lands clinical staff on ADR and every other role on Financial', () => {
    expect(getReportDefaultTab('Owner', 'pharmacy')).toBe('reports')
    expect(getReportDefaultTab('Manager', 'hospital')).toBe('reports')
    expect(getReportDefaultTab('Pharmacist', 'pharmacy')).toBe('adr-reports')
    expect(getReportDefaultTab('Nurse', 'hospital')).toBe('adr-reports')
    expect(getReportDefaultTab('Doctor', 'hospital')).toBe('adr-reports')
  })

  it('returns no default tab for roles with no report access', () => {
    expect(getReportDefaultTab('Receptionist', 'hospital')).toBeNull()
    expect(getReportDefaultTab('Cashier', 'pharmacy')).toBeNull()
  })

  it('resolves module paths — report modules deep-link to their hub tab', () => {
    expect(modulePath('reports')).toBe('/dashboard/reports/financial')
    expect(modulePath('adr-reports')).toBe('/dashboard/reports/adr')
    expect(modulePath('pos')).toBe('/dashboard/pos')
  })

  it('keeps the sidebar active on hub deep links and legacy ADR URLs', () => {
    expect(isModuleActive('reports', '/dashboard/reports')).toBe(true)
    expect(isModuleActive('reports', '/dashboard/reports/financial')).toBe(true)
    expect(isModuleActive('reports', '/dashboard/reports/adr')).toBe(false)
    expect(isModuleActive('adr-reports', '/dashboard/reports/adr')).toBe(true)
    expect(isModuleActive('adr-reports', '/dashboard/adr-reports')).toBe(true)
    expect(isModuleActive('adr-reports', '/dashboard/adr-reports/abc123/detail')).toBe(true)
    expect(isModuleActive('adr-reports', '/dashboard/reports/financial')).toBe(false)
    expect(isModuleActive('pos', '/dashboard/pos')).toBe(true)
    expect(isModuleActive('pos', '/dashboard/reports/financial')).toBe(false)
  })
})

describe('Business Discovery / Directory modules', () => {
  const nav = (role, type, custom) => getNavItems(role, type, custom).map(([id]) => id)

  it('are enterprise-only', () => {
    ;['business-discovery', 'directory'].forEach((m) => {
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
    expect(nav('Manager', 'manufacturer_importer')).toContain('business-discovery')
    expect(nav('Manager', 'manufacturer_importer')).not.toContain('directory')
    expect(nav('Regional Rep', 'manufacturer_importer')).toContain('business-discovery')
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
