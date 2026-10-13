import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useStaffActions } from './useStaffActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
const setup = () => renderHook(() => useStaffActions())
const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej }); return { p, resolve, reject } }
const auditCalls = () => callAdminAuth.mock.calls.filter(c => c[0] === 'log_audit_action')
const serverCalls = () => callAdminAuth.mock.calls.filter(c => c[0] !== 'log_audit_action')

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  admin.showToast.mockReset()
  admin.invalidateAdmin.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('createTeam', () => {
  it('sends the trimmed name, audits, refreshes once and toasts', async () => {
    const { result } = setup()
    expect(await run(() => result.current.createTeam({ name: '  Ops  ' }))).toEqual({ ok: true })
    expect(serverCalls()).toEqual([['create_team', { name: 'Ops' }]])
    expect(auditCalls()).toEqual([['log_audit_action', { auditAction: 'create_team', targetType: 'admin_team', targetId: 'Ops', metadata: {} }]])
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Team created', { type: 'success' })
  })
  it('blank name makes no call', async () => {
    const { result } = setup()
    expect(await run(() => result.current.createTeam({ name: '  ' }))).toEqual({ ok: false, error: 'Enter a team name' })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
})

describe('createStaff', () => {
  const base = { name: '  Ada L  ', email: '  Ada@X.Test ', password: 'hunter2hunter2', role: 'support', roleId: null, teamId: 't1' }
  it('system role sends newRole only, normalised email', async () => {
    const { result } = setup()
    expect(await run(() => result.current.createStaff(base))).toEqual({ ok: true })
    expect(serverCalls()).toEqual([['create_staff', { newEmail: 'ada@x.test', newPassword: 'hunter2hunter2', newName: 'Ada L', newRole: 'support', teamId: 't1' }]])
    expect(auditCalls()).toEqual([['log_audit_action', { auditAction: 'create_staff', targetType: 'admin_user', targetId: 'ada@x.test', metadata: { role: 'support', teamId: 't1', customRole: false } }]])
    expect(admin.showToast).toHaveBeenCalledWith('Staff account created', { type: 'success' })
  })
  it('custom role sends both newRole and roleId; blank team becomes null', async () => {
    const { result } = setup()
    await run(() => result.current.createStaff({ ...base, role: 'Auditor', roleId: 'r9', teamId: '' }))
    expect(serverCalls()[0][1]).toEqual({ newEmail: 'ada@x.test', newPassword: 'hunter2hunter2', newName: 'Ada L', newRole: 'Auditor', teamId: null, roleId: 'r9' })
    expect(auditCalls()[0][1].metadata).toEqual({ role: 'Auditor', teamId: null, customRole: true })
  })
  it.each([
    ['short password', { password: '1234567' }],
    ['blank name', { name: ' ' }],
    ['blank email', { email: ' ' }],
    ['super_admin', { role: 'super_admin' }],
  ])('refuses %s without a server call', async (_n, over) => {
    const { result } = setup()
    const out = await run(() => result.current.createStaff({ ...base, ...over }))
    expect(out.ok).toBe(false)
    expect(typeof out.error).toBe('string')
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it('the password appears nowhere except the create_staff call', async () => {
    const password = 'S3cret-Pass-Phrase!'
    const { result } = setup()
    await run(() => result.current.createStaff({ ...base, password }))
    callAdminAuth.mockRejectedValueOnce(new Error('server said no'))
    await run(() => result.current.createStaff({ ...base, email: 'b@x.test', password }))
    const withPassword = callAdminAuth.mock.calls.filter(c => JSON.stringify(c).includes(password))
    expect(withPassword.map(c => c[0])).toEqual(['create_staff', 'create_staff'])
    for (const spy of [admin.showToast, admin.invalidateAdmin, console.error, console.log, console.warn]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(password)
    }
    expect(JSON.stringify(auditCalls())).not.toContain('Ada L')
  })
  it('the password is not in a failed audit log line either', async () => {
    const password = 'S3cret-Pass-Phrase!'
    callAdminAuth.mockImplementation((a) => (a === 'log_audit_action' ? Promise.reject(new Error('audit down')) : Promise.resolve({})))
    const { result } = setup()
    expect(await run(() => result.current.createStaff({ ...base, password }))).toEqual({ ok: true })
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(password)
  })
})

describe('super_admin is never created or assigned', () => {
  const staff = { name: 'A', email: 'a@x.test', password: 'longenough1', teamId: null }
  it.each(['Super_Admin', ' super_admin ', 'Super Admin', 'super_admin'])('createStaff refuses role %j', async (role) => {
    const { result } = setup()
    expect((await run(() => result.current.createStaff({ ...staff, role })) ).ok).toBe(false)
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it.each(['Super_Admin', ' super_admin ', 'Super Admin', 'super_admin'])('createRole refuses name %j', async (name) => {
    const { result } = setup()
    expect(await run(() => result.current.createRole({ name, tabs: {} }))).toEqual({ ok: false, error: 'That role name is reserved' })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it.each(['Super Admin', 'super_admin', ' SUPER_ADMIN '])('assignRole refuses roleName %j', async (roleName) => {
    const { result } = setup()
    expect(await run(() => result.current.assignRole({ staffId: 's1', roleId: 'r1', roleName }))).toEqual({ ok: false, error: "The console can't promote someone to super admin" })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it.each([undefined, '', '  '])('assignRole refuses a missing role name %j', async (roleName) => {
    const { result } = setup()
    expect((await run(() => result.current.assignRole({ staffId: 's1', roleId: 'r1', roleName }))).ok).toBe(false)
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
})

describe('other actions', () => {
  it('toggleStaff deactivate and reactivate', async () => {
    const { result } = setup()
    await run(() => result.current.toggleStaff({ id: 's1', isActive: false }))
    expect(serverCalls()).toEqual([['toggle_staff', { staffId: 's1', isActive: false }]])
    expect(auditCalls()[0][1]).toEqual({ auditAction: 'toggle_staff', targetType: 'admin_user', targetId: 's1', metadata: { isActive: false } })
    expect(admin.showToast).toHaveBeenCalledWith('Staff member deactivated', { type: 'success' })
    await run(() => result.current.toggleStaff({ id: 's1', isActive: true }))
    expect(admin.showToast).toHaveBeenLastCalledWith('Staff member reactivated', { type: 'success' })
  })
  it('assignRole', async () => {
    const { result } = setup()
    await run(() => result.current.assignRole({ staffId: 's1', roleId: 'r1', roleName: 'Support' }))
    expect(serverCalls()).toEqual([['assign_admin_role', { staffId: 's1', roleId: 'r1' }]])
    expect(auditCalls()[0][1]).toEqual({ auditAction: 'assign_role', targetType: 'admin_user', targetId: 's1', metadata: { roleId: 'r1' } })
    expect(admin.showToast).toHaveBeenCalledWith('Role changed', { type: 'success' })
  })
  it('createRole always includes overview and audits sorted enabled tabs', async () => {
    const { result } = setup()
    await run(() => result.current.createRole({ name: ' Mod ', description: undefined, tabs: { users: true, posts: true, shop: false } }))
    expect(serverCalls()).toEqual([['create_admin_role', { name: 'Mod', description: '', carefindTabs: { overview: true, users: true, posts: true, shop: false } }]])
    expect(auditCalls()[0][1]).toEqual({ auditAction: 'create_role', targetType: 'admin_role', targetId: 'Mod', metadata: { tabs: ['overview', 'posts', 'users'] } })
    expect(admin.showToast).toHaveBeenCalledWith('Role created', { type: 'success' })
  })
  it('createRole with a blank name makes no call', async () => {
    const { result } = setup()
    expect((await run(() => result.current.createRole({ name: ' ', tabs: {} }))).ok).toBe(false)
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it('updateRole sends description only when given and forces overview', async () => {
    const { result } = setup()
    await run(() => result.current.updateRole({ roleId: 'r1', tabs: { users: true, overview: false } }))
    expect(serverCalls()[0]).toEqual(['update_admin_role', { roleId: 'r1', carefindTabs: { overview: true, users: true } }])
    await run(() => result.current.updateRole({ roleId: 'r1', description: 'd', tabs: {} }))
    expect(serverCalls()[1][1]).toEqual({ roleId: 'r1', carefindTabs: { overview: true }, description: 'd' })
    expect(auditCalls()[0][1]).toMatchObject({ auditAction: 'update_role', targetType: 'admin_role', targetId: 'r1' })
    expect(admin.showToast).toHaveBeenCalledWith('Role updated', { type: 'success' })
  })
  it('deleteRole sends only roleId', async () => {
    const { result } = setup()
    await run(() => result.current.deleteRole({ roleId: 'r1' }))
    expect(serverCalls()).toEqual([['delete_admin_role', { roleId: 'r1' }]])
    expect(auditCalls()[0][1]).toMatchObject({ auditAction: 'delete_role', targetType: 'admin_role', targetId: 'r1' })
    expect(admin.showToast).toHaveBeenCalledWith('Role deleted', { type: 'success' })
  })
})

describe('failure handling', () => {
  it('a rejected call returns the message with no toast, audit or refresh', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('nope'))
    const { result } = setup()
    expect(await run(() => result.current.createTeam({ name: 'x' }))).toEqual({ ok: false, error: 'nope' })
    expect(auditCalls()).toEqual([])
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
  it('a rejecting audit or refresh still returns ok', async () => {
    callAdminAuth.mockImplementation((a) => (a === 'log_audit_action' ? Promise.reject(new Error('audit')) : Promise.resolve({})))
    admin.invalidateAdmin.mockRejectedValue(new Error('refresh'))
    const { result } = setup()
    expect(await run(() => result.current.createTeam({ name: 'x' }))).toEqual({ ok: true })
    expect(admin.showToast).toHaveBeenCalledTimes(1)
  })
})

describe('in-flight guard', () => {
  it('refuses a repeated key, allows other keys, releases after the refresh', async () => {
    const d = deferred()
    callAdminAuth.mockImplementation((a) => (a === 'toggle_staff' ? d.p : Promise.resolve({})))
    const refresh = deferred()
    admin.invalidateAdmin.mockReturnValue(refresh.p)
    const { result } = setup()
    let first
    act(() => { first = result.current.toggleStaff({ id: 's1', isActive: false }) })
    expect(result.current.isBusy('toggleStaff', 's1')).toBe(true)
    expect(result.current.busy).toBe('toggleStaff')
    expect(await run(() => result.current.toggleStaff({ id: 's1', isActive: false }))).toEqual({ ok: false, error: 'Already running' })
    expect(serverCalls()).toHaveLength(1)
    expect(result.current.isBusy('toggleStaff', 's2')).toBe(false)
    await act(async () => { d.resolve({}) })
    expect(result.current.isBusy('toggleStaff', 's1')).toBe(true) // held until the refresh lands
    await act(async () => { refresh.resolve(); await first })
    expect(result.current.isBusy('toggleStaff', 's1')).toBe(false)
    expect(result.current.busy).toBeNull()
  })
  it('releases the key after the 10 s cap when the refresh hangs', async () => {
    vi.useFakeTimers()
    admin.invalidateAdmin.mockReturnValue(new Promise(() => {}))
    const { result } = setup()
    let p
    act(() => { p = result.current.deleteRole({ roleId: 'r1' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(result.current.isBusy('deleteRole', 'r1')).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await p })
    expect(result.current.isBusy('deleteRole', 'r1')).toBe(false)
  })
})
