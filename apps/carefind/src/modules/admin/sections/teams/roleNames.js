// Role-name rules shared by the Teams panels. `norm` is the server's rule for
// role names (create_admin_role): trimmed, lower-cased, spaces to underscores.
export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '_')

// The five built-in roles a console admin may assign, in display order, with
// the labels the legacy Teams tab used. super_admin is deliberately absent.
export const SYSTEM_ROLES = ['moderator', 'verification_officer', 'business_manager', 'support_agent', 'analytics_manager']
export const SYSTEM_ROLE_LABELS = {
  moderator: 'Content Moderator',
  verification_officer: 'Verification Officer',
  business_manager: 'Business Manager',
  support_agent: 'Support Agent',
  analytics_manager: 'Analytics Manager',
}

// "verification_officer" -> "verification officer".
export const spaced = (name) => (typeof name === 'string' && name ? name.replace(/_/g, ' ') : '—')

// A role the console treats as built in: flagged, one of the five, or super_admin.
export const isSystemRole = (r) => !!r.is_system || SYSTEM_ROLES.includes(norm(r.name)) || norm(r.name) === 'super_admin'
