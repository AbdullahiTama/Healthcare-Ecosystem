// Platform Super Admin permissions — CareFindHub (spec section 5)
// Reuses the shape of lib/permissions.js (ROLES / buildCustomPerms / getPerms)
// but for the 8 platform sections. Stored as admin_roles.permissions jsonb.
// Shape: { Dashboard: true, Businesses: true, "Team-Agents": true, ... }
// The navCatalogueFor concept from the existing permission checklist is reused:
// registerCustomRoles -> platform role rows, navCatalogueFor -> PLATFORM_NAV filtering.

export const PLATFORM_PERMISSIONS = [
  'Dashboard',
  'Businesses',
  'Team-Agents',
  'Team-Platform',
  'Applications',
  'Ledger',
  'Payouts',
  'Coverage',
  'Health',
  'Money',
  'Trust',
]

export const PLATFORM_NAV = [
  { id: 'dashboard', label: 'Dashboard', perm: 'Dashboard' },
  { id: 'businesses', label: 'Businesses', perm: 'Businesses' },
  { id: 'team-agents', label: 'Team – Agents', perm: 'Team-Agents' },
  { id: 'team-platform', label: 'Team – Platform', perm: 'Team-Platform' },
  { id: 'applications', label: 'Applications', perm: 'Applications' },
  { id: 'ledger', label: 'Ledger', perm: 'Ledger' },
  { id: 'payouts', label: 'Payouts', perm: 'Payouts' },
  { id: 'coverage', label: 'Coverage', perm: 'Coverage' },
  { id: 'health', label: 'Health', perm: 'Health' },
  { id: 'money', label: 'Money', perm: 'Money' },
  { id: 'trust', label: 'Trust', perm: 'Trust' },
]

export function normalizePlatformPermissions(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  // Support both legacy array ['Dashboard','Businesses'] and object {Dashboard:true}
  if (Array.isArray(p)) {
    const out = {}
    for (const k of PLATFORM_PERMISSIONS) out[k] = p.includes(k)
    return out
  }
  const out = {}
  for (const k of PLATFORM_PERMISSIONS) out[k] = !!p[k]
  return out
}

export function hasPlatformPerm(permissions, perm) {
  const n = normalizePlatformPermissions(permissions)
  return !!n[perm]
}

// Like getPerms / navCatalogueFor for platform: filter nav by role permissions.
// If permissions is empty/null, treat as no access (secure default) — except
// super_admin which is granted all in DB seed.
export function navCatalogueFor(permissions) {
  const n = normalizePlatformPermissions(permissions)
  return PLATFORM_NAV.filter(item => n[item.perm])
}

// Build payload for admin_roles.permissions from checklist state { perm: bool }
export function buildPlatformPermissions(checklist) {
  return normalizePlatformPermissions(checklist)
}

export function platformPermsLabel(perms) {
  const n = normalizePlatformPermissions(perms)
  const enabled = PLATFORM_PERMISSIONS.filter(k => n[k])
  if (enabled.length === 0) return 'No access'
  if (enabled.length === PLATFORM_PERMISSIONS.length) return 'Full access'
  return enabled.join(', ')
}
