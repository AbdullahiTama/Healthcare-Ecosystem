import { describe, it, expect } from 'vitest'
import {
  customRoleMap, grantsStaffManagement, assignableRoles, canActOnMember,
  invitationState, seatsUsed, seatLimit, validateInvite, validateRole,
} from './staffPolicy.js'

// The client mirror of guard_staff_writes / create_staff_invitation. These
// cases are the same ones the migration's verification section runs against
// Postgres, so the page and the database agree on who may do what.
const customRoles = customRoleMap([
  { name: 'HR Lead', permissions: { nav: ['staff'], canManageStaff: true } },
  { name: 'Stockist', permissions: { nav: ['inventory'], canEditStock: true } },
  { name: 'owner', permissions: { canManageStaff: true } }, // legacy junk row
])

describe('grantsStaffManagement', () => {
  it('is true only for roles carrying canManageStaff', () => {
    expect(grantsStaffManagement('HR Lead', customRoles)).toBe(true)
    expect(grantsStaffManagement('Stockist', customRoles)).toBe(false)
    expect(grantsStaffManagement('Manager', customRoles)).toBe(false)
    expect(grantsStaffManagement('Cashier', {})).toBe(false)
    expect(grantsStaffManagement('', customRoles)).toBe(false)
  })
})

describe('assignableRoles', () => {
  it('never offers Owner in any casing, even from a custom role row', () => {
    const roles = assignableRoles({ businessType: 'pharmacy', customRoles, isOwnerLevel: true })
    expect(roles.map(r => r.toLowerCase())).not.toContain('owner')
  })

  it('lets the Owner assign management roles', () => {
    expect(assignableRoles({ businessType: 'pharmacy', customRoles, isOwnerLevel: true })).toContain('HR Lead')
  })

  it('hides management roles from a staff admin (no escalation)', () => {
    const roles = assignableRoles({ businessType: 'pharmacy', customRoles, isOwnerLevel: false })
    expect(roles).not.toContain('HR Lead')
    expect(roles).toContain('Stockist')
    expect(roles).toContain('Cashier')
  })

  it('keeps the business-type scoping of presets', () => {
    const roles = assignableRoles({ businessType: 'hospital', customRoles: {}, isOwnerLevel: true })
    expect(roles).toContain('Doctor')
    expect(roles).not.toContain('Pharmacist')
  })
})

describe('canActOnMember', () => {
  const cashier = { id: 's1', email: 'cash@x.com', role: 'Cashier' }
  const hrPeer = { id: 's2', email: 'hr2@x.com', role: 'HR Lead' }
  const meHr = { id: 's3', email: 'hr@x.com', role: 'HR Lead' }

  it('requires the manage-staff permission', () => {
    expect(canActOnMember({ member: cashier, me: null, canManage: false, isOwnerLevel: false, customRoles })).toBe(false)
  })

  it('lets the Owner act on anyone, including staff admins', () => {
    expect(canActOnMember({ member: hrPeer, me: null, canManage: true, isOwnerLevel: true, customRoles })).toBe(true)
  })

  it('stops a staff admin acting on a peer who also manages staff', () => {
    expect(canActOnMember({ member: hrPeer, me: meHr, canManage: true, isOwnerLevel: false, customRoles })).toBe(false)
    expect(canActOnMember({ member: cashier, me: meHr, canManage: true, isOwnerLevel: false, customRoles })).toBe(true)
  })

  it('never lets anyone act on their own membership', () => {
    expect(canActOnMember({ member: meHr, me: meHr, canManage: true, isOwnerLevel: false, customRoles })).toBe(false)
    expect(canActOnMember({ member: { ...meHr, id: 'other', email: 'HR@x.com' }, me: meHr, canManage: true, isOwnerLevel: false, customRoles })).toBe(false)
  })
})

describe('invitations and seats', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')

  it('reports pending vs expired only for invited rows', () => {
    expect(invitationState({ status: 'invited', invite_expires_at: '2026-10-10T00:00:00Z' }, now)).toBe('pending')
    expect(invitationState({ status: 'invited', invite_expires_at: '2026-10-09T11:59:59Z' }, now)).toBe('expired')
    expect(invitationState({ status: 'invited' }, now)).toBe('expired')
    expect(invitationState({ status: 'active' }, now)).toBe(null)
  })

  it('counts active members and pending invites as seats, not inactive ones', () => {
    expect(seatsUsed([{ status: 'active' }, { status: 'invited' }, { status: 'inactive' }])).toBe(2)
  })

  it('reads the seat limit from the plan table', () => {
    expect(seatLimit('basic')).toBe(5)
    expect(seatLimit('growth')).toBe(Infinity)
    expect(seatLimit(undefined)).toBe(5)
  })
})

describe('validateInvite / validateRole', () => {
  const ctx = { assignable: ['Manager', 'Cashier'], isEnterprise: false, customRoles, isOwnerLevel: false }

  it('requires name, a valid email and an assignable role', () => {
    expect(validateInvite({}, ctx)).toBe('Enter their full name.')
    expect(validateInvite({ fullName: 'Ada', email: 'nope' }, ctx)).toBe('Enter a valid email address.')
    expect(validateInvite({ fullName: 'Ada', email: 'ada@x.com' }, ctx)).toBe('Choose a role.')
    expect(validateInvite({ fullName: 'Ada', email: 'ada@x.com', role: 'Doctor' }, ctx)).toBe('You cannot assign this role.')
    expect(validateInvite({ fullName: 'Ada', email: 'ada@x.com', role: 'Cashier' }, ctx)).toBe(null)
  })

  it('rejects Owner explicitly', () => {
    expect(validateRole(' OWNER ', ctx)).toMatch(/business account/)
  })

  it('enterprise free-typed roles: anything but Owner, and no management role for non-owners', () => {
    const ent = { ...ctx, isEnterprise: true }
    expect(validateRole('Regional Manager', ent)).toBe(null)
    expect(validateRole('HR Lead', ent)).toMatch(/Only the business owner/)
    expect(validateRole('HR Lead', { ...ent, isOwnerLevel: true })).toBe(null)
  })
})
