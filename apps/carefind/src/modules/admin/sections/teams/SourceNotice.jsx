import { Button } from '@care-ecosystem/design-system/components/ui'
import '../../ui/admin.css'

// What a Teams source (teams, staff or roles) says when it is not a plain
// loaded list. Returns nothing for a loaded, fresh source, so the caller shows
// its own content and decides what "ok" looks like. A failed read is shown as
// failed with Retry, never as an empty list; staff the admin may not see says
// who can; a stale source keeps its data and offers a refresh.
//
// `source` is { status: 'ok' | 'error' | 'restricted', data, stale? }, or
// undefined while it is still loading.
export const isOk = (source) => source?.status === 'ok' && Array.isArray(source.data)

// list_staff selects no team_id, so rows from the real server carry no team_id
// key at all. A loaded, non-empty staff list where no row has the key means the
// server did not say who is on which team: that is "unavailable", not "no team"
// (a row that has the key, even null, means the server does say).
export const hasTeamIds = (staff) => !isOk(staff) || staff.data.length === 0 || staff.data.some(s => s && 'team_id' in s)

export default function SourceNotice({ source, noun, onRetry }) {
  if (!source || source.status === 'loading') {
    return <p role="status" className="adm-note">Loading {noun}…</p>
  }
  if (source.status === 'restricted') {
    return (
      <p className="adm-note">
        {noun === 'staff' ? 'Only a super admin can see staff accounts' : `You don't have access to ${noun}`}
      </p>
    )
  }
  if (!isOk(source)) {
    return (
      <div role="alert" className="adm-live-warn">
        <span>Couldn't load {noun}</span>
        <Button variant="ghost" size="sm" onClick={onRetry} aria-label={`Retry loading ${noun}`}>Retry</Button>
      </div>
    )
  }
  if (source.stale) {
    return (
      <div role="alert" className="adm-live-warn">
        <span>Couldn't refresh {noun}</span>
        <Button variant="ghost" size="sm" onClick={onRetry} aria-label={`Retry refreshing ${noun}`}>Retry</Button>
      </div>
    )
  }
  return null
}
