// Nav icons are lucide-react component references (ICONS.md's "one outline
// icon set" rule) — Sidebar.jsx renders each as <Icon size={16} />, not a
// string.
import {
  Home, ShoppingCart, Package, Users, Calendar, Clipboard, Receipt, Landmark,
  Truck, Search, Building2, User, BarChart2, Settings, UserCheck, Activity,
  Stethoscope, Pill, Microscope, Scan, Radio, FileText, Factory, Boxes, Map, Mail,
  ClipboardList, LayoutDashboard,
} from 'lucide-react'

export const ROLES = {
  Owner: {
    nav: ['overview','dashboard','pos','inventory','clients','appointments','consultation','expenses','debts','purchases','demand','staff','reports','settings','carefind','locations','warehouses','territories','messages','stock','orders','activity','reception','triage','doctor','rx_inbox','lab','imaging'],
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
    nav: ['dashboard','pos','inventory','clients','appointments','consultation','expenses','debts','purchases','demand','reports','carefind','messages','stock','orders','activity'],
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
  nav: ['dashboard', 'warehouses', 'territories', 'messages', 'stock', 'orders', 'activity', 'reports', 'carefind'],
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
// business can redefine e.g. "Manager" or invent "Regional Manager".
export function getPerms(role, customRoles = {}) {
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
  dashboard: { label: 'Dashboard', icon: Home, types: ALL_TYPES },
  overview: { label: 'Overview', icon: LayoutDashboard, types: ALL_TYPES },
  pos: { label: 'POS / Sales', icon: ShoppingCart, types: ALL_TYPES },
  inventory: { label: 'Inventory', icon: Package, types: ALL_TYPES },
  clients: { label: 'Clients', icon: Users, types: ALL_TYPES, labelByType: { hospital: 'Patients' } },
  appointments: { label: 'Appointments', icon: Calendar, types: RETAIL_TYPES },
  consultation: { label: 'Consultations', icon: Clipboard, types: CONSULT_TYPES },
  expenses: { label: 'Expenses', icon: Receipt, types: ALL_TYPES },
  debts: { label: 'Debts', icon: Landmark, types: ALL_TYPES },
  purchases: { label: 'Purchases', icon: Truck, types: ALL_TYPES },
  demand: { label: 'Demand', icon: ClipboardList, types: ALL_TYPES },
  carefind: { label: 'CareFind Profile', icon: Search, types: ALL_TYPES },
  locations: { label: 'Locations', icon: Building2, types: ALL_TYPES },
  staff: { label: 'Staff', icon: User, types: ALL_TYPES },
  reports: { label: 'Reports', icon: BarChart2, types: ALL_TYPES },
  settings: { label: 'Settings', icon: Settings, types: ALL_TYPES },
  reception: { label: 'Reception', icon: UserCheck, types: HOSPITAL_TYPES },
  triage: { label: 'Triage', icon: Activity, types: HOSPITAL_TYPES },
  doctor: { label: 'Doctor', icon: Stethoscope, types: HOSPITAL_TYPES },
  rx_inbox: { label: 'Rx Inbox', icon: Pill, types: HOSPITAL_TYPES },
  lab: { label: 'Laboratory', icon: Microscope, types: HOSPITAL_TYPES },
  imaging: { label: 'Imaging', icon: Scan, types: HOSPITAL_TYPES },
  activity: { label: 'Live Field Activity', icon: Radio, types: ENTERPRISE_TYPES },
  orders: { label: 'Orders & LPO', icon: FileText, types: ENTERPRISE_TYPES },
  warehouses: { label: 'Warehouses & Branches', icon: Factory, types: ENTERPRISE_TYPES },
  stock: { label: 'Stock & Batches', icon: Boxes, types: ENTERPRISE_TYPES },
  territories: { label: 'Territories', icon: Map, types: ENTERPRISE_TYPES },
  messages: { label: 'Correspondence', icon: Mail, types: ENTERPRISE_TYPES },
}

// Per-vertical ordering. Kept separate from the registry because the three
// legacy nav lists ordered their modules differently and nothing should
// depend on a reorder happening silently.
const NAV_ORDER = {
   default: ['overview', 'dashboard', 'pos', 'inventory', 'clients', 'appointments', 'consultation', 'expenses', 'debts', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'settings'],
   hospital: ['overview', 'dashboard', 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging', 'pos', 'inventory', 'clients', 'expenses', 'debts', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'settings'],
   enterprise: ['overview', 'dashboard', 'activity', 'orders', 'warehouses', 'stock', 'staff', 'territories', 'messages', 'reports', 'carefind', 'settings'],
}

function familyOf(businessType) {
  if (businessType === 'hospital') return 'hospital'
  if (businessType === 'manufacturer_importer' || businessType === 'wholesale') return 'enterprise'
  return 'default'
}

function labelFor(module, businessType) {
  return (module.labelByType && module.labelByType[businessType]) || module.label
}

// The modules a business type may use, as [id, icon, label] tuples in that
// vertical's order. This is the single gate every nav-building consumer uses.
export function getModulesForType(businessType) {
  const family = familyOf(businessType)
  return NAV_ORDER[family]
    .filter(id => MODULES[id].types.includes(businessType))
    .map(id => [id, MODULES[id].icon, labelFor(MODULES[id], businessType)])
}

export const ALL_NAV_DEFAULT = NAV_ORDER.default.map(id => [id, MODULES[id].icon, MODULES[id].label])
export const ALL_NAV_HOSPITAL = NAV_ORDER.hospital.map(id => [id, MODULES[id].icon, MODULES[id].label])
export const ALL_NAV_ENTERPRISE = NAV_ORDER.enterprise.map(id => [id, MODULES[id].icon, MODULES[id].label])

export function getNavItems(role, businessType, customRoles = {}) {
  const perms = getPerms(role, customRoles)
  return getModulesForType(businessType).filter(item => perms.nav.includes(item[0]))
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
