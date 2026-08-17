// Nav icons are lucide-react component references (ICONS.md's "one outline
// icon set" rule) — Sidebar.jsx renders each as <Icon size={16} />, not a
// string.
import {
  Home, ShoppingCart, Package, Users, Calendar, Clipboard, Receipt, Landmark,
  Truck, Search, Building2, User, BarChart2, Settings, UserCheck, Activity,
  Stethoscope, Pill, Microscope, Scan, Radio, FileText, Factory, Boxes, Map as MapIcon, Mail,
  ClipboardList, LayoutDashboard, Layers, AlertTriangle,
} from 'lucide-react'

export const ROLES = {
  Owner: {
    nav: ['overview','dashboard','pos','inventory','mastercatalog','clients','appointments','consultation','expenses','debts','purchases','demand','staff','reports','adr-reports','settings','carefind','locations','warehouses','territories','messages','stock','orders','activity','reception','triage','doctor','rx_inbox','lab','imaging'],
    canEditPrice: true,
    canEditStock: true,
    canDelete: true,
    canViewReports: true,
    canExportReports: true,
    canManageStaff: true,
    canViewFinance: true,
    canMakeSales: true,
    canViewSettings: true,
    label: 'Owner — Full Access',
  },
  Manager: {
    nav: ['dashboard','pos','inventory','clients','appointments','consultation','expenses','debts','purchases','demand','reports','adr-reports','carefind','messages','stock','orders','activity'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: true,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: true,
    canMakeSales: true,
    canViewSettings: false,
    label: 'Manager',
  },
  Pharmacist: {
    nav: ['dashboard','pos','inventory','clients','consultation','rx_inbox'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: true,
    canViewSettings: false,
    label: 'Pharmacist',
  },
  Therapist: {
    nav: ['dashboard','pos','clients','appointments','consultation'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: true,
    canViewSettings: false,
    label: 'Therapist',
  },
  Receptionist: {
    nav: ['dashboard','clients','appointments','reception'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: false,
    canViewSettings: false,
    label: 'Receptionist',
  },
  Cashier: {
    nav: ['dashboard','pos','clients'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: true,
    canViewSettings: false,
    label: 'Cashier',
  },
  Nurse: {
    nav: ['dashboard','triage','clients'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: false,
    canViewSettings: false,
    label: 'Nurse',
  },
  Doctor: {
    nav: ['dashboard','doctor','consultation','clients'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: false,
    canViewSettings: false,
    label: 'Doctor',
  },
  'Lab Technician': {
    nav: ['dashboard','lab','clients'],
    canEditPrice: false,
    canEditStock: false,
    canDelete: false,
    canViewReports: false,
    canExportReports: false,
    canManageStaff: false,
    canViewFinance: false,
    canMakeSales: false,
    canViewSettings: false,
    label: 'Lab Technician',
  },
}

// Fallback for any role name not in ROLES above — used for custom-typed titles
// (Manufacturer/Importer and Wholesale let companies type their own role names,
// so "Regional Manager", "Business Development Manager" etc won't be in the list above).
export const DEFAULT_STAFF_PERMS = {
  nav: ['dashboard', 'warehouses', 'territories', 'messages', 'stock', 'orders', 'activity', 'reports', 'adr-reports', 'carefind'],
  canEditPrice: false,
  canEditStock: false,
  canDelete: false,
  canViewReports: true,
  canExportReports: false,
  canManageStaff: false,
  canViewFinance: false,
  canMakeSales: false,
  canViewSettings: false,
  label: 'Staff',
}

// Custom business-defined roles (the `roles` table: business_id, name,
// permissions jsonb). A custom role's permissions.jsonb carries the same keys
// as the preset shapes above — this merges them over the safe defaults so a
// partially-specified role never accidentally grants more than intended.
export function buildCustomPerms(permissions) {
  const p = permissions || {}
  return {
    nav: Array.isArray(p.nav) ? p.nav : DEFAULT_STAFF_PERMS.nav,
    canEditPrice: !!p.canEditPrice,
    canEditStock: !!p.canEditStock,
    canDelete: !!p.canDelete,
    canViewReports: !!p.canViewReports,
    canExportReports: !!p.canExportReports,
    canManageStaff: !!p.canManageStaff,
    canViewFinance: !!p.canViewFinance,
    canMakeSales: !!p.canMakeSales,
    canViewSettings: !!p.canViewSettings,
    label: p.label || 'Custom Role',
  }
}

// customRoles: map of role name → permissions.jsonb (loaded from the `roles`
// table by BusinessDashboard/Staff). Custom role names override presets, so a
// business can redefine e.g. "Manager" or invent "Regional Manager". The Owner
// is the one exception: it is the business admin and must always keep full
// access, so a custom role named "Owner" (or any other custom-role row) can
// never narrow it.
export function getPerms(role, customRoles = {}) {
  if (role === 'Owner') return ROLES.Owner
  if (customRoles[role]) return buildCustomPerms(customRoles[role])
  return ROLES[role] || DEFAULT_STAFF_PERMS
}

export function can(role, action, customRoles = {}) {
  return getPerms(role, customRoles)[action] || false
}

// ── Module registry ───────────────────────────────────────────────────────────
// Single source of truth for which modules exist and which business types may
// use them. Everything that lists modules — the sidebar, the route guards and
// the Roles & Permissions editor in Staff — derives from this one table, so a
// module can never be offered in one surface and missing in another, and a
// start-up business type can never see another vertical's modules.
//
// Flow: Business Type → Module Registry → Available Modules → Role Editor.
// A module's `types` array is the gate; `labelByType` lets one module present
// differently per vertical (the same clients table is "Clients" at a pharmacy
// and "Patients" at a hospital). NAV_ORDER below only expresses the per-vertical
// ordering, which predates the registry and must not be silently reshuffled.
const ALL_TYPES = ['skincare', 'pharmacy', 'dental', 'optical', 'wellness', 'hospital', 'manufacturer_importer', 'wholesale']
const RETAIL_TYPES = ['skincare', 'pharmacy', 'dental', 'optical', 'wellness']
const HOSPITAL_TYPES = ['hospital']
const ENTERPRISE_TYPES = ['manufacturer_importer', 'wholesale']
const CONSULT_TYPES = ['skincare', 'pharmacy']

export const MODULES = {
  dashboard: { label: 'Dashboard', icon: Home, types: ALL_TYPES, section: 'overview' },
  overview: { label: 'Overview', icon: LayoutDashboard, types: ALL_TYPES, section: 'overview' },
  pos: { label: 'POS / Sales', icon: ShoppingCart, types: ALL_TYPES, section: 'operations' },
  inventory: { label: 'Inventory', icon: Package, types: ALL_TYPES, section: 'operations' },
  mastercatalog: { label: 'Master Catalog', icon: Layers, types: ALL_TYPES, section: 'ecosystem' },
  clients: { label: 'Clients', icon: Users, types: ALL_TYPES, labelByType: { hospital: 'Patients' }, section: 'patients' },
  appointments: { label: 'Appointments', icon: Calendar, types: RETAIL_TYPES, section: 'operations' },
  consultation: { label: 'Consultations', icon: Clipboard, types: CONSULT_TYPES, section: 'operations' },
  expenses: { label: 'Expenses', icon: Receipt, types: ALL_TYPES, section: 'finance' },
  debts: { label: 'Debts', icon: Landmark, types: ALL_TYPES, section: 'finance' },
  purchases: { label: 'Purchases', icon: Truck, types: ALL_TYPES, section: 'operations' },
  demand: { label: 'Demand', icon: ClipboardList, types: ALL_TYPES, section: 'intelligence' },
  carefind: { label: 'CareFind Profile', icon: Search, types: ALL_TYPES, section: 'ecosystem' },
  locations: { label: 'Locations', icon: Building2, types: ALL_TYPES, section: 'ecosystem' },
  staff: { label: 'Staff', icon: User, types: ALL_TYPES, section: 'people' },
  reports: { label: 'Reports', icon: BarChart2, types: ALL_TYPES, section: 'intelligence' },
  'adr-reports': { label: 'ADR Reports', icon: AlertTriangle, types: ALL_TYPES, section: 'intelligence' },
  settings: { label: 'Settings', icon: Settings, types: ALL_TYPES, section: 'admin' },
  reception: { label: 'Reception', icon: UserCheck, types: HOSPITAL_TYPES, section: 'clinical' },
  triage: { label: 'Triage', icon: Activity, types: HOSPITAL_TYPES, section: 'clinical' },
  doctor: { label: 'Doctor', icon: Stethoscope, types: HOSPITAL_TYPES, section: 'clinical' },
  rx_inbox: { label: 'Rx Inbox', icon: Pill, types: HOSPITAL_TYPES, section: 'clinical' },
  lab: { label: 'Laboratory', icon: Microscope, types: HOSPITAL_TYPES, section: 'clinical' },
  imaging: { label: 'Imaging', icon: Scan, types: HOSPITAL_TYPES, section: 'clinical' },
  activity: { label: 'Live Field Activity', icon: Radio, types: ENTERPRISE_TYPES, section: 'ecosystem' },
  orders: { label: 'Orders & LPO', icon: FileText, types: ENTERPRISE_TYPES, section: 'ecosystem' },
  warehouses: { label: 'Warehouses & Branches', icon: Factory, types: ENTERPRISE_TYPES, section: 'ecosystem' },
  stock: { label: 'Stock & Batches', icon: Boxes, types: ENTERPRISE_TYPES, section: 'ecosystem' },
  territories: { label: 'Territories', icon: MapIcon, types: ENTERPRISE_TYPES, section: 'ecosystem' },
  messages: { label: 'Correspondence', icon: Mail, types: ENTERPRISE_TYPES, section: 'ecosystem' },
}

// Workflow sections (docs/product/INFORMATION-ARCHITECTURE.md — "group by
// workflow, not module"). The roadmap's P2.5 grouping: Overview, Operations,
// Patients, Clinical, Finance, People, Intelligence, Ecosystem, Admin.
// SECTION_ORDER is the canonical order; MODULES[id].section is the membership
// map. Section order is intentionally fixed so a role can never reflow the
// sidebar by granting odd nav subsets.
export const NAV_SECTIONS = {
  overview: { label: 'Overview' },
  operations: { label: 'Operations' },
  patients: { label: 'Patients & Clients' },
  clinical: { label: 'Clinical' },
  finance: { label: 'Finance' },
  people: { label: 'People' },
  intelligence: { label: 'Intelligence' },
  ecosystem: { label: 'Ecosystem' },
  admin: { label: 'Admin' },
}

export const SECTION_ORDER = ['overview', 'operations', 'patients', 'clinical', 'finance', 'people', 'intelligence', 'ecosystem', 'admin']

// Per-vertical ordering. Kept separate from the registry because the three
// legacy nav lists ordered their modules differently and nothing should
// depend on a reorder happening silently.
const NAV_ORDER = {
   default: ['overview', 'dashboard', 'pos', 'inventory', 'mastercatalog', 'clients', 'appointments', 'consultation', 'expenses', 'debts', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'adr-reports', 'settings'],
   hospital: ['overview', 'dashboard', 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging', 'pos', 'inventory', 'mastercatalog', 'clients', 'expenses', 'debts', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'adr-reports', 'settings'],
   enterprise: ['overview', 'dashboard', 'activity', 'orders', 'warehouses', 'stock', 'mastercatalog', 'staff', 'territories', 'messages', 'reports', 'adr-reports', 'carefind', 'settings'],
}

function familyOf(businessType) {
  if (businessType === 'hospital') return 'hospital'
  if (businessType === 'manufacturer_importer' || businessType === 'wholesale') return 'enterprise'
  return 'default'
}

function labelFor(module, businessType) {
  return (module.labelByType && module.labelByType[businessType]) || module.label
}

// The modules a business type may use, as [id, icon, label] tuples. The
// registry's `types` array is the gate (MODULES[id].types.includes(businessType)),
// so every module a business type is allowed to use is offered — even when the
// legacy per-vertical NAV_ORDER list predates the registry and omits it (e.g.
// `pos`/`inventory` for enterprise verticals). NAV_ORDER only supplies ordering:
// the family's list first, then any remaining allowed modules in default order,
// so the Owner of an enterprise business can reach POS instead of being silently
// locked out by an ordering list that never mentioned it.
export function getModulesForType(businessType) {
  const family = familyOf(businessType)
  const ordered = NAV_ORDER[family].filter(id => MODULES[id].types.includes(businessType))
  const rest = NAV_ORDER.default.filter(id => !ordered.includes(id) && MODULES[id].types.includes(businessType))
  return [...ordered, ...rest].map(id => [id, MODULES[id].icon, labelFor(MODULES[id], businessType)])
}

export const ALL_NAV_DEFAULT = NAV_ORDER.default.map(id => [id, MODULES[id].icon, MODULES[id].label])
export const ALL_NAV_HOSPITAL = NAV_ORDER.hospital.map(id => [id, MODULES[id].icon, MODULES[id].label])
export const ALL_NAV_ENTERPRISE = NAV_ORDER.enterprise.map(id => [id, MODULES[id].icon, MODULES[id].label])

export function getNavItems(role, businessType, customRoles = {}) {
  const perms = getPerms(role, customRoles)
  return getModulesForType(businessType).filter(item => perms.nav.includes(item[0]))
}

// Grouped nav for the sidebar (docs/product/INFORMATION-ARCHITECTURE.md).
// Derives purely from the same flat ordering getNavItems uses — the registry
// and NAV_ORDER stay the single source of truth, and this only slices the
// allowed list into workflow sections so route guards and the role editor keep
// consuming the flat form unchanged. Empty sections are dropped.
export function getNavGroups(role, businessType, customRoles = {}) {
  const items = getNavItems(role, businessType, customRoles)
  const groups = new Map(SECTION_ORDER.map(id => [id, []]))
  items.forEach(item => {
    const section = MODULES[item[0]].section
    if (groups.has(section)) groups.get(section).push(item)
  })
  return SECTION_ORDER
    .filter(id => groups.get(id).length > 0)
    .map(id => ({ id, label: NAV_SECTIONS[id].label, items: groups.get(id) }))
}

export const ROLE_LIST = ['Owner', 'Manager', 'Pharmacist', 'Therapist', 'Receptionist', 'Cashier', 'Nurse', 'Doctor', 'Lab Technician']

// Preset roles offered when adding/editing staff, scoped to the business type so
// a pharmacy is never offered Doctor/Lab Technician and a hospital is never
// offered Pharmacist/Therapist — an invalid assignment that another vertical's
// module gate would silently neutralise. Enterprise businesses type their own.
export const ROLES_FOR_TYPE = {
  hospital: ['Owner', 'Manager', 'Receptionist', 'Nurse', 'Doctor', 'Lab Technician', 'Cashier'],
  retail: ['Owner', 'Manager', 'Pharmacist', 'Therapist', 'Receptionist', 'Cashier'],
  enterprise: [],
}

export function rolesForType(businessType) {
  if (businessType === 'hospital') return ROLES_FOR_TYPE.hospital
  if (businessType === 'manufacturer_importer' || businessType === 'wholesale') return ROLES_FOR_TYPE.enterprise
  return ROLES_FOR_TYPE.retail
}
