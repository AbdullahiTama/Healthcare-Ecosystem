// Nav icons are lucide-react component references (ICONS.md's "one outline
// icon set" rule) — Sidebar.jsx renders each as <Icon size={16} />, not a
// string.
import {
  Home, ShoppingCart, Package, Users, Calendar, Clipboard, Receipt, Landmark,
  Truck, Search, Building2, User, BarChart2, Settings, UserCheck, Activity,
  Stethoscope, Pill, Microscope, Scan, Radio, FileText, Factory, Boxes, Map as MapIcon, Mail,
  ClipboardList, LayoutDashboard, Layers, AlertTriangle, FileCheck, CalendarClock, Store,
  MapPin, ListChecks, Sliders,
} from 'lucide-react'

export const ROLES = {
  Owner: {
    nav: ['overview','dashboard','pos','inventory','mastercatalog','clients','appointments','consultation','expenses','debts','purchases','demand','staff','wallet','reports','adr-reports','pv-tracker','settings','carefind','locations','warehouses','territories','messages','stock','orders','activity','reception','triage','doctor','rx_inbox','lab','imaging','ecommerce'],
    canEditPrice: true,
    canEditStock: true,
    canDelete: true,
    canViewReports: true,
    canExportReports: true,
    canManageStaff: true,
    canManageDirectory: true,
    canViewFinance: true,
    canMakeSales: true,
    canViewSettings: true,
    label: 'Owner (full access)',
  },
  Manager: {
    nav: ['dashboard','pos','inventory','clients','appointments','consultation','expenses','debts','purchases','demand','reports','adr-reports','pv-tracker','carefind','messages','stock','orders','activity'],
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
    nav: ['dashboard','pos','inventory','clients','consultation','rx_inbox','adr-reports'],
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
    nav: ['dashboard','triage','clients','adr-reports'],
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
    nav: ['dashboard','doctor','consultation','clients','adr-reports'],
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
  nav: ['dashboard', 'warehouses', 'territories', 'messages', 'stock', 'orders', 'activity', 'reports', 'adr-reports', 'pv-tracker', 'carefind'],
  canEditPrice: false,
  canEditStock: false,
  canDelete: false,
  canViewReports: true,
  canExportReports: false,
  canManageStaff: false,
  canManageDirectory: false,
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
    canManageDirectory: !!p.canManageDirectory,
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

// Is this staff role a manager? Deliberately a substring test, not an equality
// check against the preset "Manager": Manufacturer/Importer and Wholesale
// tenants type their own role names (see DEFAULT_STAFF_PERMS above), so real
// businesses run "Regional Manager", "Area Manager", "<Brand> Manager". An
// exact match finds none of them.
//
// This is the ONE definition — UI gating and any server-side recipient lookup
// must both go through it. When a lookup needs to filter rows rather than test
// one value, fetch `id,role` and filter with this predicate rather than
// re-expressing the rule as a PostgREST filter, which is how the two drifted
// apart before. Owners are NOT covered here: an owner has no `staff` row at
// all, so callers handle the owner separately.
export function isManagerRole(role) {
  return /manager/i.test(role || '')
}

// Who may read ALL field activity of a business. Mirrors the database's
// caller_sees_all_activity(): the owner, a manager role, or a role the owner
// granted directory management (carehub_20261131_field_activity_access.sql).
// This only decides what the UI offers; the RESTRICTIVE select policy remains
// the security boundary, so a mismatch here can hide rows but never expose any.
export function canSeeAllActivity({ isOwner = false, role, perms } = {}) {
  return !!isOwner || isManagerRole(role) || !!(perms && perms.canManageDirectory)
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
// Two taxonomies coexist here. The legacy types (skincare…wholesale) stay on
// old business rows; the signup taxonomy in config/constants.js BUSINESS_TYPES
// (clinic, laboratory, aesthetic, spa, cosmetics, haircare, other) replaced
// them in the Sep 2026 Register redesign. Both must resolve — a registered
// type the registry doesn't know about gets an empty app. New types join the
// family lists below but never a family that belongs to another vertical (no
// clinical set for beauty types, no enterprise set beyond manufacturer/wholesale).
const ALL_TYPES = ['skincare', 'pharmacy', 'dental', 'optical', 'wellness', 'hospital', 'manufacturer_importer', 'wholesale', 'clinic', 'laboratory', 'aesthetic', 'spa', 'cosmetics', 'haircare', 'other']
// RETAIL_TYPES is the `appointments` gate — the appointment-driven types.
const RETAIL_TYPES = ['skincare', 'pharmacy', 'dental', 'optical', 'wellness', 'clinic', 'aesthetic', 'spa', 'haircare']
const HOSPITAL_TYPES = ['hospital']
const ENTERPRISE_TYPES = ['manufacturer_importer', 'wholesale']
// CONSULT_TYPES is the `consultation` gate — same appointment-driven four, per
// the landing spec (businessTypes.js: "Appointment-driven types (clinic, spa,
// aesthetic, haircare) genuinely get the appointments and consultation modules").
const CONSULT_TYPES = ['skincare', 'pharmacy', 'clinic', 'aesthetic', 'spa', 'haircare']

export const MODULES = {
  dashboard: { label: 'Dashboard', icon: Home, types: ALL_TYPES, section: 'overview' },
  overview: { label: 'Overview', icon: LayoutDashboard, types: ALL_TYPES, section: 'overview' },
  pos: { label: 'POS / Sales', icon: ShoppingCart, types: ALL_TYPES, section: 'operations' },
  inventory: { label: 'Stock Management', icon: Package, types: ALL_TYPES, section: 'operations' },
  mastercatalog: { label: 'Master Catalog', icon: Layers, types: ALL_TYPES, section: 'ecosystem' },
  clients: { label: 'Clients', icon: Users, types: ALL_TYPES, labelByType: { hospital: 'Patients', clinic: 'Patients' }, section: 'patients' },
  appointments: { label: 'Appointments', icon: Calendar, types: RETAIL_TYPES, section: 'operations' },
  consultation: { label: 'Consultations', icon: Clipboard, types: CONSULT_TYPES, section: 'operations' },
  expenses: { label: 'Expenses', icon: Receipt, types: ALL_TYPES, section: 'finance' },
  debts: { label: 'Debts', icon: Landmark, types: ALL_TYPES, section: 'finance' },
  purchases: { label: 'Purchases', icon: Truck, types: ALL_TYPES, section: 'operations' },
  demand: { label: 'Demand', icon: ClipboardList, types: ALL_TYPES, section: 'intelligence' },
  carefind: { label: 'CareFind Profile', icon: Search, types: ALL_TYPES, section: 'ecosystem' },
  locations: { label: 'Locations', icon: Building2, types: ALL_TYPES, section: 'ecosystem' },
  staff: { label: 'Staff', icon: User, types: ALL_TYPES, section: 'people' },
  // Reports Hub (planning-artifacts/ux-designs/…/EXPERIENCE.md §2 IA). The hub
  // lives at /dashboard/reports; each report module deep-links to its tab via
  // `path`. More tabs (operational, client & sales, compliance, scheduled) are
  // appended to the registry + REPORT_TABS as their modules ship (Phase 2/3).
  wallet: { label: 'Wallet', icon: Landmark, types: ALL_TYPES, section: 'finance' },
  reports: { label: 'Financial Reports', icon: BarChart2, types: ALL_TYPES, section: 'intelligence', path: '/dashboard/reports/financial' },
  'adr-reports': { label: 'Pharmacovigilance (ADR)', icon: AlertTriangle, types: ALL_TYPES, section: 'intelligence', path: '/dashboard/reports/adr' },
  'pv-tracker': { label: 'PV Tracker', icon: Factory, types: ENTERPRISE_TYPES, section: 'intelligence', path: '/dashboard/reports/pv-tracker' },
  ecommerce: { label: 'Online Store', icon: Store, types: ALL_TYPES, section: 'ecosystem' },
  settings: { label: 'Settings', icon: Settings, types: ALL_TYPES, section: 'admin' },
  reception: { label: 'Reception', icon: UserCheck, types: HOSPITAL_TYPES, section: 'clinical' },
  triage: { label: 'Triage', icon: Activity, types: HOSPITAL_TYPES, section: 'clinical' },
  doctor: { label: 'Doctor', icon: Stethoscope, types: HOSPITAL_TYPES, section: 'clinical' },
  rx_inbox: { label: 'Rx Inbox', icon: Pill, types: HOSPITAL_TYPES, section: 'clinical' },
  // The lab bench serves hospitals and stand-alone laboratories.
  lab: { label: 'Laboratory', icon: Microscope, types: [...HOSPITAL_TYPES, 'laboratory'], section: 'clinical' },
  imaging: { label: 'Imaging', icon: Scan, types: HOSPITAL_TYPES, section: 'clinical' },
  // The rep's own field tool: check in, log visits, their reports. The key stays `activity` so stored role
  // permissions keep working.
  activity: { label: 'Field', icon: Radio, types: ENTERPRISE_TYPES, section: 'field' },
  // The company's management of the field team. These are NOT granted through a role's nav list: `access`
  // decides (see accessAllows), so a role editor switch can never hand a rep the manager pages.
  'field-reports': { label: 'Team reports', icon: ClipboardList, types: ENTERPRISE_TYPES, section: 'field-team', path: '/dashboard/field-team/reports', access: 'field-manager' },
  'field-customers': { label: 'Customers', icon: Building2, types: ENTERPRISE_TYPES, section: 'field-team', path: '/dashboard/field-team/customers', access: 'field-manager' },
  'field-checkins': { label: 'Team check-ins', icon: MapPin, types: ENTERPRISE_TYPES, section: 'field-team', path: '/dashboard/field-team/checkins', access: 'field-manager' },
  'field-approvals': { label: 'Order approvals', icon: FileCheck, types: ENTERPRISE_TYPES, section: 'field-team', path: '/dashboard/field-team/approvals', access: 'field-manager' },
  'field-places': { label: 'Places to confirm', icon: ListChecks, types: ENTERPRISE_TYPES, section: 'field-team', path: '/dashboard/field-team/places', access: 'place-reviewer' },
  'field-fields': { label: 'Report fields', icon: Sliders, types: ENTERPRISE_TYPES, section: 'field-team', path: '/dashboard/field-team/fields', access: 'owner' },
  discovery: { label: 'Facility Discovery', icon: Search, types: ENTERPRISE_TYPES, section: 'ecosystem' },
  // There is deliberately no 'directory', 'business-discovery' or 'intelligence' module here: the
  // Business Directory belongs to the platform-admin console only (Admin > Directory). Reads and writes
  // are closed to companies by RLS (carehub_20261202 and carehub_20261208); the only thing a company
  // keeps is the bounded nearby suggestion in Live Field Activity (nearby_directory_businesses).
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
  field: { label: 'Field' },
  'field-team': { label: 'Field team' },
  operations: { label: 'Operations' },
  patients: { label: 'Patients & Clients' },
  clinical: { label: 'Clinical' },
  finance: { label: 'Finance' },
  people: { label: 'People' },
  intelligence: { label: 'Intelligence' },
  ecosystem: { label: 'Ecosystem' },
  admin: { label: 'Admin' },
}

export const SECTION_ORDER = ['overview', 'field', 'field-team', 'operations', 'patients', 'clinical', 'finance', 'people', 'intelligence', 'ecosystem', 'admin']

// Per-vertical ordering. Kept separate from the registry because the three
// legacy nav lists ordered their modules differently and nothing should
// depend on a reorder happening silently.
const NAV_ORDER = {
   default: ['overview', 'dashboard', 'pos', 'inventory', 'mastercatalog', 'clients', 'appointments', 'consultation', 'expenses', 'debts', 'wallet', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'adr-reports', 'ecommerce', 'settings'],
    // Clinics lead with the appointment book and consultation notes.
    clinic: ['overview', 'dashboard', 'appointments', 'consultation', 'pos', 'inventory', 'mastercatalog', 'clients', 'expenses', 'debts', 'wallet', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'adr-reports', 'ecommerce', 'settings'],
    hospital: ['overview', 'dashboard', 'reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging', 'pos', 'inventory', 'mastercatalog', 'clients', 'expenses', 'debts', 'wallet', 'purchases', 'demand', 'carefind', 'locations', 'staff', 'reports', 'adr-reports', 'ecommerce', 'settings'],
    enterprise: ['overview', 'dashboard', 'activity', 'field-reports', 'field-customers', 'field-checkins', 'field-approvals', 'field-places', 'field-fields', 'discovery', 'orders', 'warehouses', 'stock', 'mastercatalog', 'staff', 'territories', 'messages', 'wallet', 'reports', 'adr-reports', 'pv-tracker', 'carefind', 'ecommerce', 'settings'],
}

function familyOf(businessType) {
  if (businessType === 'hospital') return 'hospital'
  if (businessType === 'manufacturer_importer' || businessType === 'wholesale') return 'enterprise'
  if (businessType === 'clinic') return 'clinic'
  // Stand-alone laboratories reuse the hospital ordering — their gate only
  // admits the lab bench from the clinical block, and `lab` sorts early.
  if (businessType === 'laboratory') return 'hospital'
  return 'default'
}

function labelFor(module, businessType) {
  return (module.labelByType && module.labelByType[businessType]) || module.label
}

// A business_type no gate knows — a future taxonomy addition, a typo, or an
// empty string — must not produce an empty app. It resolves to the generic
// "Other Healthcare" set, the modules every vertical shares.
const KNOWN_TYPES = new Set(ALL_TYPES)

function normalizeType(businessType) {
  return KNOWN_TYPES.has(businessType) ? businessType : 'other'
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
  const type = normalizeType(businessType)
  const family = familyOf(type)
  const ordered = NAV_ORDER[family].filter(id => MODULES[id].types.includes(type))
  const rest = NAV_ORDER.default.filter(id => !ordered.includes(id) && MODULES[id].types.includes(type))
  return [...ordered, ...rest].map(id => [id, MODULES[id].icon, labelFor(MODULES[id], type)])
}

// The legacy role-grantable lists: access-ruled modules (the Field team pages) are not role-granted, so they
// are not listed.
export const ALL_NAV_DEFAULT = NAV_ORDER.default.filter(isRoleGrantable).map(id => [id, MODULES[id].icon, MODULES[id].label])
export const ALL_NAV_HOSPITAL = NAV_ORDER.hospital.filter(isRoleGrantable).map(id => [id, MODULES[id].icon, MODULES[id].label])
export const ALL_NAV_ENTERPRISE = NAV_ORDER.enterprise.filter(isRoleGrantable).map(id => [id, MODULES[id].icon, MODULES[id].label])

// What a field rep's login offers when their role is neither a preset nor a custom role (the live "Medical
// sales rep" is one): their field tool, orders, and messages to the office.
export const FIELD_REP_NAV = ['activity', 'orders', 'messages']

// A module with an `access` rule is decided by that rule alone; a role's nav list neither grants nor
// removes it. 'field-manager' is the same rule that decides who sees the whole team's activity. 'place-reviewer'
// mirrors the database's is_business_manager (the owner, or a role named as a manager), which alone may confirm or
// dismiss a place a rep added; "Manage field team" does not reach it.
function accessAllows(module, { role, perms }) {
  if (module.access === 'owner') return role === 'Owner'
  if (module.access === 'place-reviewer') return role === 'Owner' || isManagerRole(role)
  if (module.access === 'field-manager') return canSeeAllActivity({ isOwner: role === 'Owner', role, perms })
  return false
}

// Whether the Roles editor may offer a module as a switch. Access-ruled modules are never role-granted.
export function isRoleGrantable(id) {
  return !!MODULES[id] && !MODULES[id].access
}

export function getNavItems(role, businessType, customRoles = {}) {
  const perms = getPerms(role, customRoles)
  // A manufacturer's or wholesaler's unrecognised staff role is a field rep unless its name marks a manager
  // (the live "Regional Manager" keeps today's menu). Other business types keep the shared fallback.
  const repFallback = perms === DEFAULT_STAFF_PERMS && familyOf(normalizeType(businessType)) === 'enterprise' && !isManagerRole(role)
  const nav = repFallback ? FIELD_REP_NAV : perms.nav
  return getModulesForType(businessType).filter(item => {
    const module = MODULES[item[0]]
    return module.access ? accessAllows(module, { role, perms }) : nav.includes(item[0])
  })
}

// Where a person lands after signing in: the dashboard when they have it, else their Field page (a rep),
// else the first page they may open. Never a page they cannot open, so the route guard cannot loop.
export function landingRoute(allowedKeys) {
  if (allowedKeys.includes('dashboard')) return 'dashboard'
  if (allowedKeys.includes('activity')) return 'activity'
  return allowedKeys[0] || 'dashboard'
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

// ── Reports Hub (planning-artifacts/ux-designs/…/EXPERIENCE.md §2 taxonomy) ──
// Canonical tab order for /dashboard/reports. REPORT_TABS is the single source
// of truth for the hub's tab bar; a tab must both exist in MODULES and be
// granted in a role's nav array before it can appear here. More tabs are
// appended as their modules ship (Phase 2/3: operational, client & sales,
// compliance, scheduled).
export const REPORT_TABS = ['reports', 'adr-reports']

// Deep-linkable URL slug per tab — /dashboard/reports/:slug. The sidebar items
// deep-link via MODULES[id].path, which resolves to these slugs.
export const REPORT_TAB_SLUGS = {
  reports: 'financial',
  'adr-reports': 'adr',
}

// Reverse lookup for the :tab route param (ReportsHub).
export const slugToReportTab = Object.fromEntries(
  Object.entries(REPORT_TAB_SLUGS).map(([id, slug]) => [slug, id])
)

export function reportTabSlug(id) {
  return REPORT_TAB_SLUGS[id]
}

// The tabs a role may actually open, in canonical order, filtered through the
// same role/business-type matrix the sidebar and route guards use.
export function getReportTabs(role, businessType, customRoles = {}) {
  const allowed = getNavItems(role, businessType, customRoles).map(item => item[0])
  return REPORT_TABS.filter(id => allowed.includes(id))
}

// Role-aware landing tab (EXPERIENCE.md §2): clinical staff (Pharmacist, Nurse,
// Doctor) land on ADR, every other report-granted role lands on Financial.
// Falls back to the first tab a role can access so a role never lands on a tab
// it cannot open.
export function getReportDefaultTab(role, businessType, customRoles = {}) {
  const tabs = getReportTabs(role, businessType, customRoles)
  if (tabs.length === 0) return null
  if (['Pharmacist', 'Nurse', 'Doctor'].includes(role) && tabs.includes('adr-reports')) return 'adr-reports'
  if (tabs.includes('reports')) return 'reports'
  return tabs[0]
}

// Sidebar deep links: report modules resolve to their hub tab path, everything
// else to /dashboard/:id.
export function modulePath(id) {
  return MODULES[id]?.path || `/dashboard/${id}`
}

// Sidebar active state. Report modules are hub deep links, and the legacy
// /dashboard/adr-reports* URLs (list + detail) keep the ADR item highlighted
// while a report is open.
export function isModuleActive(id, pathname) {
  if (id === 'reports') {
    return pathname === '/dashboard/reports' || pathname.startsWith('/dashboard/reports/financial')
  }
  if (id === 'adr-reports') {
    return pathname.startsWith('/dashboard/reports/adr') || pathname.startsWith('/dashboard/adr-reports')
  }
  if (id === 'pv-tracker') {
    return pathname.startsWith('/dashboard/reports/pv-tracker')
  }
  return pathname.split('/').pop() === id
}

export const ROLE_LIST = ['Owner', 'Manager', 'Pharmacist', 'Therapist', 'Receptionist', 'Cashier', 'Nurse', 'Doctor', 'Lab Technician']

// Preset roles offered when adding/editing staff, scoped to the business type so
// a pharmacy is never offered Doctor/Lab Technician and a hospital is never
// offered Pharmacist/Therapist — an invalid assignment that another vertical's
// module gate would silently neutralise. Enterprise businesses type their own.
// The signup-taxonomy keys follow the same rule: a role is only offered where
// that type's modules can actually show its nav (no Pharmacist at a cosmetics
// shop, no Doctor at a laboratory).
export const ROLES_FOR_TYPE = {
  hospital: ['Owner', 'Manager', 'Receptionist', 'Nurse', 'Doctor', 'Lab Technician', 'Cashier'],
  retail: ['Owner', 'Manager', 'Pharmacist', 'Therapist', 'Receptionist', 'Cashier'],
  enterprise: [],
  clinic: ['Owner', 'Manager', 'Receptionist', 'Doctor', 'Cashier'],
  laboratory: ['Owner', 'Manager', 'Lab Technician', 'Cashier'],
  aesthetic: ['Owner', 'Manager', 'Therapist', 'Receptionist', 'Cashier'],
  spa: ['Owner', 'Manager', 'Therapist', 'Receptionist', 'Cashier'],
  haircare: ['Owner', 'Manager', 'Therapist', 'Receptionist', 'Cashier'],
  cosmetics: ['Owner', 'Manager', 'Receptionist', 'Cashier'],
  other: ['Owner', 'Manager', 'Receptionist', 'Cashier'],
}

export function rolesForType(businessType) {
  const type = normalizeType(businessType)
  if (type === 'manufacturer_importer' || type === 'wholesale') return ROLES_FOR_TYPE.enterprise
  return ROLES_FOR_TYPE[type] || ROLES_FOR_TYPE.retail
}
