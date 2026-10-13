import { Radio, Calendar } from 'lucide-react'
import { Button, Empty } from '@care-ecosystem/design-system/components/ui'
import { useLiveShows } from '../hooks/useLiveShows'
import LiveShowCard from './live/LiveShowCard.jsx'
import ScheduledShowCard from './live/ScheduledShowCard.jsx'
import StartShowPanel from './live/StartShowPanel.jsx'
import '../ui/admin.css'

// Go Live: shows on air, shows scheduled, and the panel to start or schedule
// one. Each list is read independently: a failed read says so with Retry and
// is never shown as an empty list.

// -> { status: 'loading' } | { status: 'error' } | { status: 'ok', data }
const sourceOf = (query, key) => {
  const settled = query.data?.[key]
  if (settled) return settled
  if (query.isError) return { status: 'error' }
  return { status: 'loading' }
}

function ShowList({ source, noun, emptyText, icon, retry, render }) {
  if (source.status === 'error') {
    return (
      <div role="alert" className="adm-live-warn adm-live-inset-warn">
        <span>Couldn't load {noun}</span>
        <Button variant="ghost" size="sm" onClick={retry} aria-label={`Retry loading ${noun}`}>Retry</Button>
      </div>
    )
  }
  if (source.status === 'loading') {
    return <p role="status" className="adm-note adm-live-inset">Loading {noun}…</p>
  }
  if (source.data.length === 0) {
    return <Empty icon={icon} message={emptyText} cause="none" />
  }
  return (
    <>
      {source.stale && (
        <div role="alert" className="adm-live-warn adm-live-inset-warn">
          <span>Couldn't refresh {noun}</span>
          <Button variant="ghost" size="sm" onClick={retry} aria-label={`Retry refreshing ${noun}`}>Retry</Button>
        </div>
      )}
      <div className="adm-live-list adm-live-inset">{source.data.map(render)}</div>
    </>
  )
}

export default function GoLiveSection() {
  const query = useLiveShows()
  const retry = () => query.refetch()
  const active = sourceOf(query, 'active')
  const scheduled = sourceOf(query, 'scheduled')
  const liveCount = active.status === 'ok' ? active.data.length : 0

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Go Live</h1>
          <p className="adm-note">Manage live shows on CareFind</p>
        </div>
      </header>

      <section className="adm-panel" aria-labelledby="golive-active-h">
        <div className="adm-phead">
          <h2 id="golive-active-h">Currently live{active.status === 'ok' ? ` (${liveCount})` : ''}</h2>
        </div>
        <ShowList source={active} noun="live shows" emptyText="No live shows right now"
          icon={<Radio size={40} strokeWidth={1.5} />} retry={retry}
          render={show => <LiveShowCard key={show.id} show={show} />} />
      </section>

      <StartShowPanel liveCount={liveCount} />

      <section className="adm-panel" aria-labelledby="golive-scheduled-h">
        <div className="adm-phead"><h2 id="golive-scheduled-h">Scheduled shows</h2></div>
        <ShowList source={scheduled} noun="scheduled shows" emptyText="No scheduled shows"
          icon={<Calendar size={40} strokeWidth={1.5} />} retry={retry}
          render={show => <ScheduledShowCard key={show.id} show={show} />} />
      </section>
    </div>
  )
}
