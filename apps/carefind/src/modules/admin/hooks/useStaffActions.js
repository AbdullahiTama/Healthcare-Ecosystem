import { useCallback, useRef, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'
import { capped } from '../lib/capped'
import { ALL_TABS } from '../navigation'

// Team, staff and role actions for the Teams screen. Each resolves { ok } or
// { ok: false, error } so the form can show a failure where the admin is
// looking. After the server call succeeds, the audit entry, the refresh and the
// toast are all best effort: once the server has committed, the admin must
// never be told the action failed.
//
// Security: createStaff creates a privileged account. The password goes to the
// create_staff call and nowhere else: not the audit entry (which records the
// email, role and team only), not a toast, not a log line, not an error. The
// server error message is returned as-is and never includes the request.
//
// In-flight guard: each run has a key `${action}:${target ?? ''}`. A run whose
// key is already running resolves { ok: false, error: 'Already running' } with
// no server call, so a double click cannot create twice. The key is held until
// the refresh has landed, capped at 10 s so a hung query cannot disable the
// controls for good. createStaff and createRole use an empty target: one at a
// time, whatever the email or name, so the UI should read `busy === 'createStaff'`
// (or 'createRole') to disable its form. `isBusy(action, target)` drives the UI; `busy` is the
// action name of the oldest running key, or null.

const REFRESH_CAP_MS = 10000

const MIN_PASSWORD = 8
// The server's rule for role names (create_admin_role): trimmed, lower-cased,
// spaces to underscores. super_admin must never be created or assigned from here.
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '_')
// navigation's isAllowed treats any key that is not false as allowed, so the
// saved map must be complete: every assignable section is explicitly true or
// false (true only when passed as exactly true), plus overview. Unknown keys
// the caller passed are kept.
const withOverview = (tabs = {}) => ({
  ...tabs,
  ...Object.fromEntries(ALL_TABS.map(t => [t.key, tabs[t.key] === true])),
  overview: true,
})
const enabledTabs = (tabs) => Object.keys(tabs).filter(k => tabs[k] === true).sort()

export function useStaffActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const running = useRef(new Set())
  const [busyKeys, setBusyKeys] = useState([])
  const isBusy = useCallback((action, target) => busyKeys.includes(`${action}:${target ?? ''}`), [busyKeys])
  const busy = busyKeys.length ? busyKeys[0].split(':')[0] : null

  // `audit` is [auditAction, targetType, targetId, metadata].
  const perform = useCallback(async (name, target, serverAction, payload, audit, success) => {
    const key = `${name}:${target ?? ''}`
    if (running.current.has(key)) return { ok: false, error: 'Already running' }
    running.current.add(key)
    setBusyKeys([...running.current])
    try {
      try {
        await callAdminAuth(serverAction, payload)
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
      await capped((async () => {
        const [auditAction, targetType, targetId, metadata] = audit
        // Together, so a slow audit cannot eat the refresh's share of the cap.
        await Promise.all([
          bestEffort(`auditing ${auditAction}`, () => callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })),
          bestEffort(`refreshing after ${name}`, invalidateAdmin),
        ])
      })(), REFRESH_CAP_MS)
      bestEffort(`toasting ${name}`, () => showToast(success, { type: 'success' }))
      return { ok: true }
    } finally {
      running.current.delete(key)
      setBusyKeys([...running.current])
    }
  }, [showToast, invalidateAdmin])

  const createTeam = useCallback(({ name }) => {
    const clean = (name || '').trim()
    if (!clean) return Promise.resolve({ ok: false, error: 'Enter a team name' })
    return perform('createTeam', clean, 'create_team', { name: clean },
      ['create_team', 'admin_team', clean, {}], 'Team created')
  }, [perform])

  const createStaff = useCallback(({ name, email, password, role, roleId, teamId }) => {
    const cleanName = (name || '').trim()
    const cleanEmail = (email || '').trim().toLowerCase()
    if (!cleanName) return Promise.resolve({ ok: false, error: 'Enter a name' })
    if (!cleanEmail) return Promise.resolve({ ok: false, error: 'Enter an email address' })
    if ((password || '').length < MIN_PASSWORD) return Promise.resolve({ ok: false, error: `Password must be at least ${MIN_PASSWORD} characters` })
    if (!role || norm(role) === 'super_admin') return Promise.resolve({ ok: false, error: 'Pick a role for this account' })
    const team = teamId || null
    // The audit entry never carries the password or the name.
    return perform('createStaff', null, 'create_staff', {
      newEmail: cleanEmail, newPassword: password, newName: cleanName, newRole: role, teamId: team,
      ...(roleId ? { roleId } : {}),
    }, ['create_staff', 'admin_user', cleanEmail, { role, teamId: team, customRole: !!roleId }], 'Staff account created')
  }, [perform])

  const toggleStaff = useCallback(({ id, isActive }) => perform('toggleStaff', id, 'toggle_staff', { staffId: id, isActive },
    ['toggle_staff', 'admin_user', id, { isActive }], isActive ? 'Staff member reactivated' : 'Staff member deactivated'), [perform])

  // assign_admin_role sets the staff member's role to the role's name, so
  // assigning the system super_admin role would promote them. The server does
  // not enforce this refusal (finding 87): it is only this client check, so the
  // caller must pass the real name of the role being assigned.
  const assignRole = useCallback(({ staffId, roleId, roleName }) => {
    if (!norm(roleName)) return Promise.resolve({ ok: false, error: 'Pick a role' })
    if (norm(roleName) === 'super_admin') return Promise.resolve({ ok: false, error: "The console can't promote someone to super admin" })
    return perform('assignRole', staffId, 'assign_admin_role', { staffId, roleId },
      ['assign_role', 'admin_user', staffId, { roleId }], 'Role changed')
  }, [perform])

  const createRole = useCallback(({ name, description, tabs }) => {
    const clean = (name || '').trim()
    if (!clean) return Promise.resolve({ ok: false, error: 'Enter a role name' })
    if (norm(clean) === 'super_admin') return Promise.resolve({ ok: false, error: 'That role name is reserved' })
    const carefindTabs = withOverview(tabs)
    return perform('createRole', null, 'create_admin_role', { name: clean, description: description || '', carefindTabs },
      ['create_role', 'admin_role', clean, { tabs: enabledTabs(carefindTabs) }], 'Role created')
  }, [perform])

  // Permissions are sent only when `tabs` is passed, and then as the complete
  // map ({} means everything off except overview). A caller that wants to change
  // permissions must pass the full existing map; a description-only edit leaves
  // permissions untouched.
  const updateRole = useCallback(({ roleId, description, tabs }) => {
    if (tabs === undefined && description === undefined) return Promise.resolve({ ok: false, error: 'Nothing to change' })
    const carefindTabs = tabs === undefined ? undefined : withOverview(tabs)
    return perform('updateRole', roleId, 'update_admin_role',
      { roleId, ...(carefindTabs ? { carefindTabs } : {}), ...(description !== undefined ? { description } : {}) },
      ['update_role', 'admin_role', roleId, carefindTabs ? { tabs: enabledTabs(carefindTabs) } : {}], 'Role updated')
  }, [perform])

  const deleteRole = useCallback(({ roleId }) => perform('deleteRole', roleId, 'delete_admin_role', { roleId },
    ['delete_role', 'admin_role', roleId, {}], 'Role deleted'), [perform])

  return { busy, isBusy, createTeam, createStaff, toggleStaff, assignRole, createRole, updateRole, deleteRole }
}
