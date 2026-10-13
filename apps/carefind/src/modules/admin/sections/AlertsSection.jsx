import {
  Bell, Shield, Building2, AlertTriangle, DollarSign, ClipboardList, Newspaper, CalendarClock, ChevronRight,
} from 'lucide-react'
import { Button } from '@care-ecosystem/design-system/components/ui'
import { useAlerts } from '../hooks/useAlerts'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { isAllowed } from '../navigation'
import { timeAgo } from '../ui'
import '../ui/admin.css'

const ICON_MAP = {
  verification: Shield,
  claim: Building2,
  report: AlertTriangle,
  withdrawal: DollarSign,
  task: ClipboardList,
  consultation: CalendarClock,
  news: Newspaper,
}

const GROUPS = [['urgent', 'Urgent'], ['warning', 'Warning'], ['info', 'Info']]
const severityOf = (alert) => (GROUPS.some(([key]) => key === alert.severity) ? alert.severity : 'info')

function AlertCard({ alert, severity, label, canOpen, onOpen }) {
  const Icon = ICON_MAP[alert.type] || Bell
  const body = (
    <>
      <span className={`adm-alert-icon adm-alert-icon--${severity}`} aria-hidden="true"><Icon size={18} /></span>
      <span className="adm-alert-text">
        <span className="adm-item-title adm-alert-wrap">{alert.title}</span>
        {alert.subtitle && <span className="adm-item-sub adm-alert-wrap">{alert.subtitle}</span>}
        <span className="adm-alert-meta">
          <span className="adm-item-time">{timeAgo(alert.time)}</span>
          <span className={`adm-sev adm-sev--${severity}`}>{label}</span>
          {!canOpen && <span className="adm-note">Not available to your role</span>}
        </span>
      </span>
      {canOpen ? <span className="adm-chev" aria-hidden="true"><ChevronRight size={16} /></span> : <span />}
    </>
  )
  return (
    <li>
      {canOpen
        ? <button type="button" className={`adm-btn-reset adm-alert adm-alert--${severity}`} onClick={onOpen}>{body}</button>
        : <div className={`adm-alert adm-alert--${severity}`}>{body}</div>}
    </li>
  )
}

// Everything pending that needs an admin. Sources are read independently, so
// the screen says which could not be checked and never claims "all clear"
// unless every source loaded and nothing is pending.
export default function AlertsSection({ onOpenTab }) {
  const { data, isLoading, isError, isFetching, refetch } = useAlerts()
  const { permissions } = useAdmin()

  const failedAll = !data && isError
  const stale = !!data && isError
  const loading = !data && !failedAll && isLoading
  const alerts = data?.alerts || []
  const failed = data?.failed || []

  let body
  if (failedAll) {
    body = (
      <div role="alert" className="adm-notice">
        Couldn't check alerts.{' '}
        <Button variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching} loadingText="Checking…">Retry</Button>
      </div>
    )
  } else if (loading || !data) {
    body = <p role="status" className="adm-clear">Checking for pending itemsâ€¦</p>
  } else {
    body = (
      <>
        {stale && (
          <div role="status" className="adm-live-warn">
            <span>Couldn't refresh, showing the last loaded data.</span>
            <Button variant="ghost" size="sm" aria-label="Retry refreshing alerts" onClick={() => refetch()} loading={isFetching} loadingText="Checking…">Retry</Button>
          </div>
        )}
        {failed.length > 0 && (
          <div role="alert" className="adm-notice adm-panel">
            {`Couldn't check: ${failed.join(', ')}. Items of these kinds may be waiting. `}
            <Button variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching} loadingText="Checking…">Retry</Button>
          </div>
        )}
        {alerts.length === 0 && (
          <p className="adm-clear adm-panel">
            {failed.length === 0 ? 'All clear â€” nothing pending' : 'Nothing pending in the sources that loaded'}
          </p>
        )}
        {GROUPS.map(([key, label]) => {
          const group = alerts.filter(a => severityOf(a) === key)
          if (group.length === 0) return null
          return (
            <section key={key} className="adm-panel" aria-labelledby={`alerts-${key}-h`}>
              <div className="adm-phead">
                <h2 id={`alerts-${key}-h`}>{label}</h2>
                <span className="adm-note adm-num">{group.length}</span>
              </div>
              <ul className="adm-queue" aria-labelledby={`alerts-${key}-h`}>
                {group.map(a => (
                  <AlertCard key={`${a.type}-${a.id}`} alert={a} severity={key} label={label}
                    canOpen={isAllowed(permissions, a.tab)} onOpen={() => onOpenTab(a.tab)} />
                ))}
              </ul>
            </section>
          )
        })}
      </>
    )
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Notifications</h1>
          <p className="adm-note">All pending items requiring your attention</p>
        </div>
      </header>
      {body}
    </div>
  )
}
