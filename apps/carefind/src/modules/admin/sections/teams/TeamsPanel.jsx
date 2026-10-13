import { useEffect, useId, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { Button, Empty, Input, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import SourceNotice, { hasTeamIds, isOk } from './SourceNotice.jsx'
import { useStaffActions } from '../../hooks/useStaffActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import '../../ui/admin.css'

// Teams and who is on them. `teams` and `staff` are the settled sources from
// useTeamsData. A failed teams read says so with Retry; "No members yet" is
// only said when staff really loaded and the team really has none. Staff
// problems are not alerted here (the staff directory, or the section's own
// note for a non-super admin, owns that). The create form is only for a super
// admin (`canCreate`). Names and roles are rendered as text, never as markup.

const roleLabel = (role) => (typeof role === 'string' && role ? role.replace(/_/g, ' ') : '—')
const memberName = (m) => m.full_name || m.email || 'Unnamed'

function CreateTeamForm() {
  const { createTeam, busy } = useStaffActions()
  const { showToast } = useAdmin()
  const ids = useId()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const running = busy === 'createTeam'

  const submit = async (e) => {
    e.preventDefault()
    if (running) return
    setError('')
    const res = await createTeam({ name })
    // A result after the panel has gone is toasted, not dropped.
    if (!mounted.current) {
      if (!res.ok) showToast(`Couldn't create the team: ${res.error}`, { type: 'error' })
      return
    }
    if (res.ok) setName('')
    else setError(`Couldn't create the team: ${res.error}`)
  }

  return (
    <form onSubmit={submit} aria-label="Create a team" className="adm-team-form">
      <Input id={`${ids}-name`} label="Team name" value={name} onChange={setName} placeholder="e.g. Trust and safety"
        aria-required="true" disabled={running} />
      <Button type="submit" variant="primary" disabled={running} loading={running} loadingText="Adding…"
        leftIcon={<Users size={14} aria-hidden="true" />}>
        Add team
      </Button>
      {error && <p role="alert" className="adm-live-alert" style={{ flexBasis: '100%' }}>{error}</p>}
    </form>
  )
}

function Members({ team, staff }) {
  // Loading and restricted are said once for the panel; a failed read is said
  // here quietly, because the staff directory owns the alert and its Retry.
  if (staff?.status === 'error') return <p className="adm-note">Members unavailable</p>
  if (!isOk(staff)) return null
  if (!hasTeamIds(staff)) return <p className="adm-note">Team membership isn't available yet</p>
  const members = staff.data.filter(s => s.team_id === team.id)
  if (members.length === 0) return <p className="adm-note">No members yet</p>
  return (
    <ul className="adm-team-members" aria-label={`Members of ${team.name}`}>
      {members.map(m => (
        <li key={m.id} className="adm-team-member">
          <span className="adm-team-member-name">
            <strong>{memberName(m)}</strong>
            <span className="adm-note">{roleLabel(m.role)}</span>
          </span>
          <StatusBadge status={m.is_active ? 'active' : 'suspended'} />
        </li>
      ))}
    </ul>
  )
}

export default function TeamsPanel({ teams, staff, canCreate = false, onRetry }) {
  const teamsNotice = <SourceNotice source={teams} noun="teams" onRetry={onRetry} />
  return (
    <section className="adm-teams" aria-label="Teams">
      {canCreate && <CreateTeamForm />}
      {teamsNotice}
      {/* Only the loading placeholder and the restricted note live here; a
          failed or stale staff read is alerted by the staff directory. */}
      {isOk(teams) && (!staff || staff.status === 'loading') && <SourceNotice source={staff} noun="staff" onRetry={onRetry} />}
      {isOk(teams) && staff?.status === 'restricted' && <p className="adm-note">Members are visible to super admins</p>}
      {isOk(teams) && (teams.data.length === 0
        ? <Empty message="No teams yet" cause="none" />
        : teams.data.map(t => (
          <section key={t.id} className="adm-panel adm-team-card" aria-label={`Team ${t.name}`}>
            <h3>{t.name}</h3>
            <Members team={t} staff={staff} />
          </section>
        )))}
    </section>
  )
}
