import { useEffect, useId, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { Button, Empty, Input, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import SourceNotice, { isOk } from './SourceNotice.jsx'
import { useStaffActions } from '../../hooks/useStaffActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import '../../ui/admin.css'

// Teams and who is on them. `teams` and `staff` are the settled sources from
// useTeamsData. A source that failed says so with Retry; "No members yet" is
// only said when staff really loaded and the team really has none. Names and
// roles are rendered as text, never as markup.

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
  if (!isOk(staff)) return null
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

export default function TeamsPanel({ teams, staff, onRetry }) {
  const teamsNotice = <SourceNotice source={teams} noun="teams" onRetry={onRetry} />
  return (
    <section className="adm-teams" aria-label="Teams">
      <CreateTeamForm />
      {teamsNotice}
      {/* Staff is read once for the whole list, so its failure is said once. */}
      {isOk(teams) && <SourceNotice source={staff} noun="staff" onRetry={onRetry} />}
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
