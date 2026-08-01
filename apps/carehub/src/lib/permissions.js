export const ROLES = {
  Owner: {
    nav: ['dashboard','pos','inventory','clients','appointments','consultation','expenses','debts','purchases','demand','staff','reports','settings','carefind','locations','warehouses','territories','messages','stock','orders','activity','reception','triage','doctor','rx_inbox','lab','imaging'],
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

// Nav icons are lucide-react component references (ICONS.md's "one outline
// icon set" rule) — Sidebar.jsx renders each as <Icon size={16} />, not a
// string. This was the last emoji-driven config in CareHub's primary chrome;
// migrating it (rather than leaving it emoji while Sidebar.jsx itself moved
// to the design system) is what closes out that gap.
import {
  Home, ShoppingCart, Package, Users, Calendar, Clipboard, Receipt, Landmark,
  Truck, Search, Building2, User, BarChart2, Settings, UserCheck, Activity,
  Stethoscope, Pill, Microscope, Scan, Radio, FileText, Factory, Boxes, Map, Mail,
  ClipboardList,
} from 'lucide-react'

export const ALL_NAV_DEFAULT = [
  ['dashboard', Home, 'Dashboard'],
  ['pos', ShoppingCart, 'POS / Sales'],
  ['inventory', Package, 'Inventory'],
  ['clients', Users, 'Clients'],
  ['appointments', Calendar, 'Appointments'],
  ['consultation', Clipboard, 'Consultations'],
  ['expenses', Receipt, 'Expenses'],
  ['debts', Landmark, 'Debts'],
  ['purchases', Truck, 'Purchases'],
  ['demand', ClipboardList, 'Demand'],
  ['carefind', Search, 'CareFind Profile'],
  ['locations', Building2, 'Locations'],
  ['staff', User, 'Staff'],
  ['reports', BarChart2, 'Reports'],
  ['settings', Settings, 'Settings'],
]

export const ALL_NAV_HOSPITAL = [
  ['dashboard', Home, 'Dashboard'],
  ['reception', UserCheck, 'Reception'],
  ['triage', Activity, 'Triage'],
  ['doctor', Stethoscope, 'Doctor'],
  ['rx_inbox', Pill, 'Rx Inbox'],
  ['lab', Microscope, 'Laboratory'],
  ['imaging', Scan, 'Imaging'],
  ['pos', ShoppingCart, 'POS / Sales'],
  ['inventory', Package, 'Inventory'],
  ['clients', Users, 'Patients'],
  ['expenses', Receipt, 'Expenses'],
  ['debts', Landmark, 'Debts'],
  ['purchases', Truck, 'Purchases'],
  ['demand', ClipboardList, 'Demand'],
  ['carefind', Search, 'CareFind Profile'],
  ['locations', Building2, 'Locations'],
  ['staff', User, 'Staff'],
  ['reports', BarChart2, 'Reports'],
  ['settings', Settings, 'Settings'],
]

// Manufacturer / Importer / Wholesale — dedicated warehouse & hierarchy system
export const ALL_NAV_ENTERPRISE = [
  ['dashboard', Home, 'Dashboard'],
  ['activity', Radio, 'Live Field Activity'],
  ['orders', FileText, 'Orders & LPO'],
  ['warehouses', Factory, 'Warehouses & Branches'],
  ['stock', Boxes, 'Stock & Batches'],
  ['staff', Users, 'Sales Team'],
  ['territories', Map, 'Territories'],
  ['messages', Mail, 'Correspondence'],
  ['reports', BarChart2, 'Reports'],
  ['carefind', Search, 'CareFind Profile'],
  ['settings', Settings, 'Settings'],
]

export function getNavItems(role, businessType, customRoles = {}) {
  const perms = getPerms(role, customRoles)
  let all = ALL_NAV_DEFAULT
  if (businessType === 'hospital') all = ALL_NAV_HOSPITAL
  if (businessType === 'manufacturer_importer' || businessType === 'wholesale') all = ALL_NAV_ENTERPRISE
  // Consultation forms are a skincare-only module — hide for every other
  // business type even though several presets grant the route.
  if (businessType !== 'skincare') all = all.filter(i => i[0] !== 'consultation')
  return all.filter(item => perms.nav.includes(item[0]))
}

export const ROLE_LIST = ['Owner', 'Manager', 'Pharmacist', 'Therapist', 'Receptionist', 'Cashier', 'Nurse', 'Doctor', 'Lab Technician']
