import { can, rolesForType, isReservedRoleName } from '../../../lib/permissions'
import { planLimitsFor } from '../../../lib/planLimits'

// ── Staff governance, client side ─────────────────────────────────────────────
// The UI mirror of the rules the database enforces in guard_staff_writes /
// guard_role_writes / create_staff_invitation
// (sql/20261009_staff_invitations_and_role_governance.sql). The database is the
// authority — these exist so the page only offers actions that will succeed,
// and explains why the others are missing. Keep the two in step.
//
//   * The Owner is the business account. Not a staff role; never assignable.
//   * Managing staff needs canManageStaff (the Owner always has it).
//   * Only the Owner may grant canManageStaff, or act on someone who has it.
//   * Nobody acts on their own membership.

export const INVITE_TTL_DAYS = 7
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// roles table rows → { name: permissions } as getPerms expects.
export function customRoleMap(roles = []) {
  const map = {}
  for (const r of roles) map[r.name] = r.permissions || {}
  return map
}

export function grantsStaffManagement(roleName, customRoles = {}) {
  if (!roleName) return false
  return !!can(roleName, 'canManageStaff', customRoles)
}

// Role names this actor may put on a staff member. Presets valid for the
// business type, then custom roles; reserved names never; management-granting
// roles only for the Owner.
export function assignableRoles({ businessType, customRoles = {}, isOwnerLevel }) {
  const names = [...rolesForType(businessType), ...Object.keys(customRoles)]
  return [...new Set(names)].filter(name =>
    !isReservedRoleName(name) && (isOwnerLevel || !grantsStaffManagement(name, customRoles)))
}

// May the current actor change or remove this member?
export function canActOnMember({ member, me, canManage, isOwnerLevel, customRoles = {} }) {
  if (!canManage || !member) return false
  if (me && (member.id === me.id || String(member.email || '').toLowerCase() === String(me.email || '').toLowerCase())) return false
  if (!isOwnerLevel && grantsStaffManagement(member.role, customRoles)) return false
  return true
}

// 'pending' | 'expired' for an invitation row, null for a member.
export function invitationState(member, now = Date.now()) {
  if (member?.status !== 'invited') return null
  const expires = member.invite_expires_at ? new Date(member.invite_expires_at).getTime() : 0
  return expires > now ? 'pending' : 'expired'
}

// Seats are held by active members and pending invitations — the same count
// create_staff_invitation checks against the plan.
export function seatsUsed(staff = []) {
  return staff.filter(s => s.status === 'active' || s.status === 'invited').length
}

export function seatLimit(plan) {
  return planLimitsFor(plan).maxStaff
}

// First problem with an invite form, or null. Server-side rules (owner email,
// duplicates, cross-business membership) are reported by the API.
// Enterprise businesses type free-form role names, so for them the check is
// "not reserved, and not a management role unless you are the Owner" rather
// than membership of the picker list.
export function validateRole(role, { assignable = [], isEnterprise = false, customRoles = {}, isOwnerLevel = false } = {}) {
  const name = String(role || '').trim()
  if (!name) return 'Choose a role.'
  if (isReservedRoleName(name)) return '"Owner" is the business account itself and cannot be given to staff.'
  if (isEnterprise) {
    if (!isOwnerLevel && grantsStaffManagement(name, customRoles)) return 'Only the business owner can assign a role that manages staff.'
    return null
  }
  if (!assignable.includes(name)) return 'You cannot assign this role.'
  return null
}

export function validateInvite(form = {}, roleContext = {}) {
  if (!String(form.fullName || '').trim()) return 'Enter their full name.'
  if (!EMAIL_RE.test(String(form.email || '').trim())) return 'Enter a valid email address.'
  return validateRole(form.role, roleContext)
}
