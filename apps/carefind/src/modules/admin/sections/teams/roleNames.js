import { norm } from '../../lib/normName'

// Role-name rules shared by the Teams panels.
export { norm }

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

// Custom roles a console admin may assign or pick: real rows, not built in, not
// one of the five, never super_admin however it is spelled.
export const assignableCustomRoles = (rows) => (Array.isArray(rows) ? rows : []).filter(r => r && r.id != null
  && typeof r.name === 'string' && !r.is_system && !SYSTEM_ROLES.includes(norm(r.name)) && norm(r.name) !== 'super_admin')
