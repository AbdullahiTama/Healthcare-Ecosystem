import { useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useOverviewData, listsFrom, SOURCE_CAPS } from '../hooks/useOverviewData'
import { buildAttentionQueue, filterBySeverity, countBySeverity, openItems, oldestTime } from '../lib/attention'
import { isAllowed } from '../navigation'
import { timeAgo } from '../ui'
import MetricStrip from '../ui/MetricStrip.jsx'
import SplitBar from '../ui/SplitBar.jsx'
import ActivityRange from './ActivityRange.jsx'
import '../ui/admin.css'

const SEVERITY_LABEL = { urgent: 'Urgent', warning: 'Warning', info: 'Info' }
const TABS = [['all', 'All'], ['urgent', 'Urgent'], ['warning', 'Warning'], ['info', 'Info']]

// The dashboard: totals, what needs attention, and the current split of the
// work queues. Everything comes from useOverviewData; nothing is estimated,
// and a source that failed is shown as failed, never as zero.
export default function OverviewSection({ permissions, onOpenTab }) {
  const { data, isLoading, refetch, dataUpdatedAt } = useOverviewData()
  const [severity, setSeverity] = useState('all')

  const { lists, capped } = listsFrom(data)
  const allowed = (tab) => tab == null || isAllowed(permissions, tab)

  const count = (type, name) => {
    const list = lists[name]
    const status = isLoading ? 'loading' : list ? 'ok' : 'error'
    if (!list) return { status }
    const open = openItems(type, list)
    const oldest = oldestTime(open)
    return {
      status,
      value: `${open.length}${capped.includes(name) ? '+' : ''}`,
      hint: open.length === 0 ? 'Nothing waiting' : oldest ? `Oldest ${timeAgo(oldest)}` : undefined,
    }
  }
  const total = (name, hint) => {
    const t = data?.totals?.[name]
    const status = isLoading ? 'loading' : t?.status === 'ok' ? 'ok' : 'error'
    return { status, value: t?.data?.toLocaleString(), hint }
  }
  const transactions = (() => {
    const list = lists.transactions
    if (isLoading) return { status: 'loading' }
    if (!list) return { status: 'error' }
    const isCapped = capped.includes('transactions')
    return { status: 'ok', value: `${list.length}${isCapped ? '+' : ''}`, hint: isCapped ? `Latest ${SOURCE_CAPS.transactions} loaded` : 'All loaded' }
  })()

  const cells = [
    { key: 'users', label: 'Users', tab: 'users', ...total('users', 'Total registered') },
    { key: 'businesses', label: 'Businesses', tab: 'businesses', ...total('businesses', 'Total registered') },
    { key: 'verifications', label: 'Pending verification', tab: 'verifications', ...count('verification', 'verifications') },
    { key: 'claims', label: 'Pending claims', tab: 'claims', ...count('claim', 'claims') },
    { key: 'reports', label: 'Open reports', tab: 'reports', ...count('report', 'reports') },
    { key: 'transactions', label: 'Transactions', tab: 'revenue', ...transactions },
    { key: 'withdrawals', label: 'Pending withdrawals', tab: 'withdrawals', ...count('withdrawal', 'withdrawals') },
    { key: 'posts24h', label: 'Posts, last 24 hours', tab: 'posts', ...total('posts24h', 'Platform activity') },
  ].filter(c => allowed(c.tab)).map(c => ({ ...c, onRetry: refetch, onOpen: () => onOpenTab(c.tab) }))

  const { rows: allRows, unavailable } = buildAttentionQueue(lists, { capped })
  const rows = allRows.filter(r => allowed(r.tab))
  const counts = countBySeverity(rows)
  const shown = filterBySeverity(rows, severity)
  const failedLabels = unavailable.filter(type => allowed(queueTab(type))).map(queueLabel)

  return (
    <div className="adm-page">
      <div className="adm-head">
        <h1>Dashboard</h1>
        <div className="adm-meta">
          {dataUpdatedAt ? <span>Updated {timeAgo(new Date(dataUpdatedAt).toISOString())}</span> : null}
          <button type="button" className="adm-btn-reset" aria-label="Refresh" onClick={() => refetch()} style={{ display: 'flex', padding: 6 }}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <MetricStrip items={cells} />

      <div className="adm-row">
        <section className="adm-panel" aria-labelledby="adm-queue-title">
          <div className="adm-phead">
            <h2 id="adm-queue-title">Needs attention</h2>
            <span className="adm-note adm-num">{counts.all} waiting</span>
          </div>
          <div className="adm-tabs" role="tablist" aria-label="Filter by severity">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={severity === key} className="adm-btn-reset adm-tab adm-num" onClick={() => setSeverity(key)}>
                {label} {counts[key]}
              </button>
            ))}
          </div>
          {failedLabels.length > 0 && (
            <div className="adm-notice" role="alert">
              {`Couldn't load: ${failedLabels.join(', ')}. Items of these kinds may be waiting. `}
              <button type="button" className="adm-btn-reset adm-retry" onClick={() => refetch()}>Retry</button>
            </div>
          )}
          {isLoading ? (
            <p className="adm-clear" role="status">Loading what needs attention…</p>
          ) : shown.length === 0 ? (
            failedLabels.length === 0 && <p className="adm-clear">{rows.length === 0 ? 'All clear' : 'Nothing at this level'}</p>
          ) : (
            <ul className="adm-queue" aria-label="Needs attention">
              {shown.map(row => <QueueRow key={row.type} row={row} onOpen={row.tab ? () => onOpenTab(row.tab) : null} />)}
            </ul>
          )}
        </section>

        <section className="adm-panel" aria-labelledby="adm-state-title">
          <div className="adm-phead"><h2 id="adm-state-title">Current state</h2></div>
          <div className="adm-state">
            {stateBars(lists, capped, allowed)}
          </div>
        </section>
      </div>

      <ActivityRange />
    </div>
  )
}

function QueueRow({ row, onOpen }) {
  const body = (
    <>
      <span style={{ minWidth: 0 }}>
        <span className="adm-item-title">{row.title}</span>
        <span className="adm-item-sub">{row.subtitle}</span>
      </span>
      <span className={`adm-sev adm-sev--${row.severity}`}>{SEVERITY_LABEL[row.severity]}</span>
      <span className="adm-item-time">{row.time ? timeAgo(row.time) : ''}</span>
      <span className="adm-item-count adm-num" aria-label={`${row.count}${row.atLeast ? ' or more' : ''} waiting`}>{row.count}{row.atLeast ? '+' : ''}</span>
      {onOpen ? <span className="adm-chev" aria-hidden="true"><ChevronRight size={16} /></span> : <span />}
    </>
  )
  return (
    <li>
      {onOpen
        ? <button type="button" className="adm-btn-reset adm-item" onClick={onOpen}>{body}</button>
        : <div className="adm-item">{body}</div>}
    </li>
  )
}

const QUEUE_LABELS = { verification: 'Verification requests', claim: 'Business claims', report: 'Reported posts', withdrawal: 'Withdrawal requests', news: 'News submissions', task: 'Task submissions', consultation: 'Consultation bookings' }
const QUEUE_TABS = { verification: 'verifications', claim: 'claims', report: 'reports', withdrawal: 'withdrawals', news: 'news', task: 'tasks', consultation: null }
const queueLabel = (type) => QUEUE_LABELS[type]
const queueTab = (type) => QUEUE_TABS[type]

const split = (list, known) => {
  const segments = known.map(([status, label, tone]) => ({ label, tone, value: list.filter(r => r.status === status).length }))
  const other = list.length - segments.reduce((n, s) => n + s.value, 0)
  return other > 0 ? [...segments, { label: 'Other', tone: 'muted', value: other }] : segments
}

function stateBars(lists, capped, allowed) {
  const bars = [
    { name: 'verifications', tab: 'verifications', title: 'Verifications', known: [['pending', 'Pending', 'urgent'], ['approved', 'Approved', 'ok'], ['rejected', 'Rejected', 'muted']] },
    { name: 'reports', tab: 'reports', title: 'Reports', known: [['pending', 'Open', 'urgent'], ['resolved', 'Resolved', 'ok']] },
    { name: 'claims', tab: 'claims', title: 'Business claims', known: [['pending', 'Pending', 'urgent'], ['approved', 'Approved', 'ok'], ['rejected', 'Rejected', 'muted']] },
  ].filter(b => allowed(b.tab))
  if (bars.length === 0) return <p className="adm-note">Nothing to show for your role.</p>
  return bars.map(b => lists[b.name]
    ? (
      <div key={b.name}>
        <SplitBar title={b.title} segments={split(lists[b.name], b.known)} />
        {capped.includes(b.name) && <p className="adm-note">Based on the latest {lists[b.name].length} records.</p>}
      </div>
    )
    : <div key={b.name} className="adm-st"><header><strong>{b.title}</strong></header><p className="adm-note">Couldn't load.</p></div>)
}
