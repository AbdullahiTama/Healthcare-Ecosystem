import { Button } from '@care-ecosystem/design-system/components/ui'
import { useTeamsData } from '../hooks/useTeamsData'
import { useAdmin } from '../provider/AdminProvider.jsx'
import TeamsPanel from './teams/TeamsPanel.jsx'
import CreateStaffPanel from './teams/CreateStaffPanel.jsx'
import StaffDirectory from './teams/StaffDirectory.jsx'
import RolesPanel from './teams/RolesPanel.jsx'
import '../ui/admin.css'

// Teams & Staff. Teams are shown to every admin; creating staff, the staff
// directory and roles are for a super admin only. The staff source is never
// even read for anyone else (useTeamsData returns it as restricted). Each
// panel reads its own settled source, so one failed read never blanks the
// others. Only when the whole query has no data is the screen itself a
// placeholder or a failure; a failed refresh keeps the data and the panels
// say so themselves.

export default function TeamsSection() {
  const { adminUser } = useAdmin()
  const isSuper = adminUser?.role === 'super_admin'
  const query = useTeamsData({ canSeeStaff: isSuper })
  const refetch = () => query.refetch()
  const data = query.data

  let body
  if (!data && query.isError) {
    body = (
      <div role="alert" className="adm-live-warn">
        <span>Couldn't load teams and staff</span>
        <Button variant="ghost" size="sm" onClick={refetch} aria-label="Retry loading teams and staff">Retry</Button>
      </div>
    )
  } else if (!data) {
    body = <p role="status" className="adm-note">Loading teams and staff…</p>
  } else {
    body = (
      <>
        <TeamsPanel teams={data.teams} staff={data.staff} onRetry={refetch} />
        {isSuper ? (
          <>
            <CreateStaffPanel teams={data.teams} roles={data.roles} onRetry={refetch} />
            <StaffDirectory staff={data.staff} roles={data.roles} teams={data.teams}
              currentAdminId={adminUser?.id} onRetry={refetch} />
            <RolesPanel roles={data.roles} onRetry={refetch} />
          </>
        ) : (
          <p className="adm-note">Staff accounts and roles can only be managed by a super admin.</p>
        )}
      </>
    )
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Teams &amp; Staff</h1>
          <p className="adm-note">Manage teams, staff, and roles</p>
        </div>
      </header>
      {body}
    </div>
  )
}
