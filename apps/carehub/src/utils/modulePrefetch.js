import { getPerms, getModulesForType } from '../lib/permissions'

/**
 * Role-Based Module Prefetching
 * 
 * Intelligently prefetches modules based on the user's role during browser idle time.
 * This ensures commonly-used modules are ready when needed without blocking initial load.
 */

// Module import map - matches lazy imports in BusinessDashboard.jsx
const MODULE_IMPORTS = {
  dashboard: () => import('../modules/dashboard-home/DashboardHome'),
  pos: () => import('../modules/pos/POS'),
  inventory: () => import('../modules/inventory/Inventory'),
  clients: () => import('../modules/clients/Clients'),
  appointments: () => import('../modules/appointments/Appointments'),
  consultation: () => import('../modules/consultation/Consultation'),
  expenses: () => import('../modules/expenses/Expenses'),
  debts: () => import('../modules/debts/Debts'),
  wallet: () => import('../modules/wallet/Wallet'),
  purchases: () => import('../modules/purchases/Purchases'),
  demand: () => import('../modules/demand/Demand'),
  staff: () => import('../modules/staff/Staff'),
  reports: () => import('../modules/reports/ReportsHub'),
  settings: () => import('../modules/settings/Settings'),
  carefind: () => import('../modules/carefind/CareFind'),
  locations: () => import('../modules/locations/Locations'),
  mastercatalog: () => import('../modules/master-catalog/MasterCatalog'),
  ecommerce: () => import('../modules/ecommerce/Ecommerce'),
  warehouses: () => import('../modules/warehouses/Warehouses'),
  territories: () => import('../modules/territories/Territories'),
  messages: () => import('../modules/messages/Messages'),
  stock: () => import('../modules/stock/Stock'),
  orders: () => import('../modules/orders/Orders'),
  activity: () => import('../modules/live-activity/LiveActivity'),
  discovery: () => import('../modules/facility-discovery/FacilityDiscovery'),
  reception: () => import('../pages/dashboard/hospital/Reception'),
  triage: () => import('../pages/dashboard/hospital/Triage'),
  doctor: () => import('../pages/dashboard/hospital/Doctor'),
  rx_inbox: () => import('../pages/dashboard/hospital/RxInbox'),
  lab: () => import('../pages/dashboard/hospital/Lab'),
  imaging: () => import('../pages/dashboard/hospital/Imaging'),
  overview: () => import('../modules/overview/Overview'),
  'adr-reports': () => import('../modules/adr/AdrReportPage'),
}

// Role-specific priority modules (prefetch order)
const ROLE_PRIORITY = {
  Owner: ['overview', 'dashboard', 'pos', 'inventory', 'clients', 'staff', 'reports', 'settings'],
  Manager: ['overview', 'dashboard', 'pos', 'inventory', 'clients', 'reports'],
  Pharmacist: ['dashboard', 'pos', 'inventory', 'clients', 'rx_inbox'],
  Therapist: ['dashboard', 'pos', 'clients', 'appointments', 'consultation'],
  Receptionist: ['dashboard', 'clients', 'appointments', 'reception'],
  Cashier: ['dashboard', 'pos', 'clients'],
  Nurse: ['dashboard', 'triage', 'clients'],
  Doctor: ['dashboard', 'doctor', 'consultation', 'clients'],
  'Lab Technician': ['dashboard', 'lab', 'clients'],
}

// Default priority for custom roles
const DEFAULT_PRIORITY = ['overview', 'dashboard', 'pos', 'inventory', 'clients', 'reports']

// Track prefetched modules to avoid duplicates
const prefetched = new Set()
let prefetchQueue = []
let isPrefetching = false

/**
 * Get priority modules for a role
 */
function getPriorityModules(role) {
  return ROLE_PRIORITY[role] || DEFAULT_PRIORITY
}

/**
 * Check if browser is idle
 */
function isIdle() {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(true), { timeout: 100 })
    } else {
      // Fallback: use setTimeout for browsers without requestIdleCallback
      setTimeout(() => resolve(true), 50)
    }
  })
}

/**
 * Prefetch a single module
 */
async function prefetchModule(moduleId) {
  if (prefetched.has(moduleId) || !MODULE_IMPORTS[moduleId]) {
    return false
  }

  try {
    await MODULE_IMPORTS[moduleId]()
    prefetched.add(moduleId)
    return true
  } catch (error) {
    console.warn(`[Prefetch] Failed to prefetch module: ${moduleId}`, error)
    return false
  }
}

/**
 * Process prefetch queue during idle time
 */
async function processQueue() {
  if (isPrefetching || prefetchQueue.length === 0) {
    return
  }

  isPrefetching = true

  while (prefetchQueue.length > 0) {
    await isIdle() // Wait for browser idle
    
    const moduleId = prefetchQueue.shift()
    if (!prefetched.has(moduleId)) {
      await prefetchModule(moduleId)
    }
  }

  isPrefetching = false
}

/**
 * Start role-based prefetching
 * Call this after login when the user's role is known.
 * 
 * @param {string} role - User's role (e.g., 'Owner', 'Cashier')
 * @param {string} businessType - Business type (e.g., 'pharmacy', 'hospital')
 * @param {Object} customRoles - Custom role definitions
 */
export function startRolePrefetching(role, businessType, customRoles = {}) {
  // Clear any existing queue
  prefetchQueue = []
  
  // Get priority modules for this role
  const priorityModules = getPriorityModules(role)
  
  // Filter to only modules the role can access
  // (The route guard will block unauthorized access, but we only prefetch what's allowed)
  const allowedModules = getAllowedModules(role, businessType, customRoles)
  
  // Queue priority modules first
  const toPrefetch = priorityModules.filter(id => allowedModules.includes(id))
  
  // Add remaining allowed modules after priority
  const remaining = allowedModules.filter(id => !toPrefetch.includes(id))
  
  prefetchQueue = [...toPrefetch, ...remaining]
  
  // Start processing queue
  processQueue()
}

/**
 * Get all allowed modules for a role and business type
 */
function getAllowedModules(role, businessType, customRoles = {}) {
  const perms = getPerms(role, customRoles)
  const allModules = getModulesForType(businessType)
  
  return allModules
    .filter(([id]) => perms.nav.includes(id))
    .map(([id]) => id)
}

/**
 * Prefetch a specific module on demand
 * Use this when navigating to a module to ensure it's loaded.
 */
export async function prefetchOnDemand(moduleId) {
  if (!prefetched.has(moduleId)) {
    await prefetchModule(moduleId)
  }
}

/**
 * Check if a module has been prefetched
 */
export function isPrefetched(moduleId) {
  return prefetched.has(moduleId)
}

/**
 * Get prefetch status for debugging
 */
export function getPrefetchStatus() {
  return {
    prefetched: Array.from(prefetched),
    queued: [...prefetchQueue],
    isPrefetching,
  }
}

/**
 * Stop prefetching (e.g., on logout)
 */
export function stopPrefetching() {
  prefetchQueue = []
  isPrefetching = false
}

export default {
  startRolePrefetching,
  prefetchOnDemand,
  isPrefetched,
  getPrefetchStatus,
  stopPrefetching,
}
