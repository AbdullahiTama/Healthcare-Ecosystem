import { useEffect, useMemo, useRef, useState } from 'react'
import { UserCheck, UserX } from 'lucide-react'
import { Button, DataTable, Empty, Select, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import ReviewDrawer from '../../ui/ReviewDrawer.jsx'
import { timeAgo } from '../../ui'
import SourceNotice, { hasTeamIds, isOk } from './SourceNotice.jsx'
import { norm, spaced, SYSTEM_ROLES, assignableCustomRoles } from './roleNames.js'
import { useStaffActions } from '../../hooks/useStaffActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import '../../ui/admin.css'

// The staff directory: who has a console account, with Deactivate / Reactivate
// and Change role in a drawer. Staff are few, so the list is not paged.
//
// Security: deactivating stops the account at the server (every request checks
// is_active). The console never offers either action on the signed-in admin's
// own row, and never offers super_admin as a role: the server does not refuse
// that promotion, so it is only kept out of the choices here and in
// useStaffActions.assignRole.

const nameOf = (s) => s.full_name || s.email || 'Unnamed'
const signedIn = (d) => (!d || Number.isNaN(new Date(d).getTime()) ? '—' : timeAgo(d))
const statusOf = (s) => (s.is_active ? 'active' : 'suspended')

const DEACTIVATE_CONSEQUENCE = 'This stops them using the console: every request checks their account is active. Their account and history are kept.'
// The console can never make anyone a super admin (finding 87), so removing
// that role, or the account, from another super admin cannot be undone here.
const NO_PROMOTE_BACK = " They can't be made super admin again from the console."
const isSuperRole = (member) => norm(member.role) === 'super_admin'

const REACTIVATE_CONSEQUENCE = 'This lets them use the console again with their current role.'

// The roles a staff member can be moved to: the five system roles that exist
// as rows, plus custom roles. Never super_admin, however it is spelled.
function assignableRoles(roles) {
  if (!isOk(roles)) return []
  const rows = roles.data.filter(r => r && r.id != null && typeof r.name === 'string' && norm(r.name) !== 'super_admin')
  const system = SYSTEM_ROLES.map(name => rows.find(r => norm(r.name) === name)).filter(Boolean)
  return [...system, ...assignableCustomRoles(rows)]
}

// While mounted it marks its member as the one on screen; unmounting (drawer
// closed or another member opened) clears the mark, so a late result knows its
// drawer is gone.
function StaffBody({ member, teamName, isOwn, viewerKnown, roles, onRetry, shownId, finish, assignRole, assigning, working }) {
  const { askConfirm } = useAdmin()
  const { id } = member
  useEffect(() => {
    shownId.current = id
    return () => { if (shownId.current === id) shownId.current = null }
  }, [id, shownId])

  const [roleId, setRoleId] = useState('')
  const options = assignableRoles(roles)
  const chosen = options.find(r => String(r.id) === roleId)
  const sameRole = !!chosen && norm(chosen.name) === norm(member.role)

  const confirmChange = () => {
    if (!chosen || working) return
    askConfirm({
      title: `Change ${nameOf(member)}'s role?`,
      consequence: `They will have ${spaced(chosen.name)}'s access from their next request.${isSuperRole(member) ? NO_PROMOTE_BACK : ''}`,
      confirmLabel: 'Change role',
      action: async () => finish(id, 'change the role', await assignRole({ staffId: id, roleId: chosen.id, roleName: chosen.name })),
    })
  }

  let roleControl
  if (!viewerKnown) {
    roleControl = <p className="adm-note">Account actions are unavailable until your session loads.</p>
  } else if (isOwn) {
    roleControl = <p className="adm-note">You can't change your own account here.</p>
  } else if (!isOk(roles)) {
    roleControl = <SourceNotice source={roles} noun="roles" onRetry={onRetry} />
  } else {
    roleControl = (
      <>
        {roles.stale && <SourceNotice source={roles} noun="roles" onRetry={onRetry} />}
        <Select label="Change role" value={roleId} onChange={setRoleId} placeholder="Choose a role" disabled={working}
          options={options.map(r => ({ value: String(r.id), label: spaced(r.name) }))} />
        <Button variant="secondary" disabled={!chosen || sameRole || working} loading={assigning} loadingText="Changing…"
          onClick={confirmChange}>
          Change role
        </Button>
      </>
    )
  }

  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Name</dt><dd>{member.full_name || '—'}</dd>
        <dt>Email</dt><dd>{member.email || '—'}</dd>
        <dt>Role</dt><dd>{spaced(member.role)}</dd>
        <dt>Team</dt><dd>{teamName}</dd>
        <dt>Last sign-in</dt><dd>{signedIn(member.last_login)}</dd>
      </dl>
      <div className="adm-staff-actions">{roleControl}</div>
    </>
  )
}

export default function StaffDirectory({ staff, roles, teams, currentAdminId, onRetry }) {
  const { askConfirm, confirming, showToast } = useAdmin()
  // The one hook for the whole drawer: its in-flight guard is per instance, so a
  // second instance could run a role change while a deactivate is running.
  const { isBusy, toggleStaff, assignRole } = useStaffActions()
  const [openedId, setOpenedId] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  // The id of the member the drawer is rendering (null once none is shown).
  const shownId = useRef(null)

  const rows = useMemo(() => (isOk(staff) ? staff.data : []), [staff])
  const teamNames = useMemo(() => new Map((isOk(teams) ? teams.data : []).map(t => [t.id, t.name])), [teams])
  // A failed or unloaded teams read is never shown as "no team".
  // list_staff returns no team_id, which is said as such and never as "No team".
  const teamsKnown = hasTeamIds(staff)
  const teamOf = (s) => {
    if (!teamsKnown) return 'Not provided by the server'
    if (!s.team_id) return 'No team'
    if (!isOk(teams)) return 'Unavailable'
    return teamNames.get(s.team_id) || 'Unknown team'
  }

  // The drawer shows the row's fresh data while it is listed, else the last snapshot.
  const fresh = openedId == null ? null : rows.find(r => r.id === openedId) || null
  useEffect(() => { if (fresh && fresh !== snapshot) setSnapshot(fresh) }, [fresh, snapshot])
  const current = openedId == null ? null : fresh || snapshot

  const open = (row) => { setError(''); setSnapshot(row); setOpenedId(row.id) }
  const close = () => { setOpenedId(null); setSnapshot(null); setError('') }

  // The confirm closes before the action runs, so the admin may have closed the
  // drawer or opened another member by the time it ends. Then close and
  // setError would act on the wrong drawer: a failure is toasted instead, and a
  // success needs nothing more (the hook has toasted and refreshed).
  const finish = (id, what, res) => {
    if (shownId.current !== id) {
      if (!res.ok) showToast(`Couldn't ${what}: ${res.error}`, { type: 'error' })
      return
    }
    if (res.ok) close(); else setError(res.error)
  }

  const columns = [
    { key: 'full_name', label: 'Name', render: s => nameOf(s) },
    { key: 'email', label: 'Email', render: s => s.email || '—' },
    { key: 'role', label: 'Role', render: s => spaced(s.role) },
    { key: 'team_id', label: 'Team', render: s => teamOf(s) },
    { key: 'is_active', label: 'Status', render: s => <StatusBadge status={statusOf(s)} /> },
    { key: 'last_login', label: 'Last sign-in', render: s => signedIn(s.last_login) },
  ]

  const toggle = (m, activate) => askConfirm({
    title: `${activate ? 'Reactivate' : 'Deactivate'} ${nameOf(m)}?`,
    consequence: activate ? REACTIVATE_CONSEQUENCE : DEACTIVATE_CONSEQUENCE + (isSuperRole(m) ? NO_PROMOTE_BACK : ''),
    confirmLabel: activate ? 'Reactivate' : 'Deactivate',
    action: async () => finish(m.id, activate ? 'reactivate the account' : 'deactivate the account', await toggleStaff({ id: m.id, isActive: activate })),
  })

  // Any action running on this member blocks every action on them; other
  // members are not blocked.
  const toggling = !!current && isBusy('toggleStaff', current.id)
  const assigning = !!current && isBusy('assignRole', current.id)
  const working = toggling || assigning
  // Fails closed: while the signed-in admin is unknown, no row can be told apart
  // from their own, so no row offers an action.
  const viewerKnown = currentAdminId != null
  const isOwn = !!current && viewerKnown && current.id === currentAdminId
  const locked = !!current && (!viewerKnown || isOwn)
  const activate = !!current && !current.is_active

  const footer = current && !locked ? (
    <Button variant={activate ? 'primary' : 'danger'} fullWidth disabled={working} loading={toggling}
      loadingText={activate ? 'Reactivating…' : 'Deactivating…'}
      leftIcon={activate ? <UserCheck size={14} aria-hidden="true" /> : <UserX size={14} aria-hidden="true" />}
      onClick={() => toggle(current, activate)}>
      {activate ? 'Reactivate' : 'Deactivate'}
    </Button>
  ) : null

  return (
    <section className="adm-teams" aria-label="Staff">
      <h2 className="adm-live-subhead">Staff</h2>
      <SourceNotice source={staff} noun="staff" onRetry={onRetry} />
      {isOk(staff) && (
        <DataTable
          rows={rows}
          columns={columns}
          empty={<Empty message="No staff accounts yet" cause="none" />}
          count={`${rows.length} ${rows.length === 1 ? 'staff member' : 'staff members'}`}
          onRowClick={open}
          actions={(row) => (
            <Button size="sm" variant="ghost" aria-label={`Review ${nameOf(row)}`}
              onClick={(e) => { e.stopPropagation(); open(row) }}>
              Review
            </Button>
          )}
        />
      )}
      <ReviewDrawer show={!!current} title={current ? nameOf(current) : ''} status={current ? statusOf(current) : undefined}
        onClose={close} error={error} footer={footer} preventClose={confirming}>
        {current && (
          <StaffBody key={current.id} member={current} teamName={teamOf(current)} isOwn={isOwn} viewerKnown={viewerKnown} roles={roles}
            onRetry={onRetry} shownId={shownId} finish={finish}
            assignRole={assignRole} assigning={assigning} working={working} />
        )}
      </ReviewDrawer>
    </section>
  )
}
