import { CheckCircle, BarChart3, Clock } from 'lucide-react'
import { Button, Empty } from '@care-ecosystem/design-system/components/ui'
import { useSearchAnalytics } from '../hooks/useSearchAnalytics'
import { tallyTerms, demandGaps } from '../lib/searchTally'
import MetricStrip from '../ui/MetricStrip.jsx'
import '../ui/admin.css'

// Search analytics over the newest 300 searches (the endpoint's window). A
// failed read is shown as failed in every place, never as the empty messages.

const RECENT_LIMIT = 40
const WINDOW_HINT = 'last 300 searches'

const userOf = (row) => row.profiles?.full_name || row.profiles?.display_name || 'Guest'

// One panel: loading placeholder, failure with a named Retry, empty message, or
// the list. `noun` names the panel in the Retry button.
function Panel({ id, title, subtitle, noun, query, isEmpty, emptyIcon, emptyText, emptyCause, children }) {
  let body
  if (query.failed) {
    body = (
      <div role="alert" className="adm-notice">
        Couldn't load {noun}.{' '}
        <button type="button" className="adm-btn-reset adm-retry" aria-label={`Retry loading ${noun}`} onClick={() => query.refetch()}>Retry</button>
      </div>
    )
  } else if (query.loading) {
    body = <p role="status" className="adm-clear">Loading {noun}…</p>
  } else if (isEmpty) {
    body = <Empty icon={emptyIcon} message={emptyText} cause={emptyCause} />
  } else {
    body = children
  }
  return (
    <section className="adm-panel" aria-labelledby={id}>
      <div className="adm-phead">
        <div>
          <h2 id={id}>{title}</h2>
          <p className="adm-note">{subtitle}</p>
        </div>
      </div>
      {body}
    </section>
  )
}

export default function SearchesSection() {
  const { data, isLoading, isError, refetch } = useSearchAnalytics()
  const failed = !data && isError
  const loading = !data && !failed && isLoading
  const query = { failed, loading, refetch }

  const rows = data || []
  const gaps = demandGaps(rows)
  const terms = tallyTerms(rows)
  const recent = rows.slice(0, RECENT_LIMIT)
  const status = failed ? 'error' : loading ? 'loading' : 'ok'

  const cells = [
    { key: 'searches', label: 'Searches', value: rows.length.toLocaleString(), hint: WINDOW_HINT },
    { key: 'missed', label: 'Found nothing', value: rows.filter(r => !r.found).length.toLocaleString(), hint: WINDOW_HINT },
  ].map(c => ({ ...c, status, onRetry: () => refetch() }))

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Search Analytics</h1>
          <p className="adm-note">Track user search behavior and identify demand gaps. Based on the newest 300 searches.</p>
        </div>
      </header>

      <MetricStrip items={cells} label="Search totals" />

      <Panel id="searches-gaps-h" title="Demand gaps" subtitle="Products and services people want that you don't have yet"
        noun="demand gaps" query={query} isEmpty={gaps.length === 0}
        emptyIcon={<CheckCircle size={40} strokeWidth={1.5} />} emptyText="No unmet searches yet" emptyCause="positive">
        <ul className="adm-queue" aria-label="Demand gaps">
          {gaps.map(([term, count]) => (
            <li key={term} className="adm-srow">
              <span className="adm-srow-main">{term}</span>
              <span className="adm-sev adm-sev--urgent adm-num">{count}× wanted</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="searches-terms-h" title="Most searched terms" subtitle="Popular queries across all users"
        noun="top terms" query={query} isEmpty={terms.length === 0}
        emptyIcon={<BarChart3 size={40} strokeWidth={1.5} />} emptyText="No searches yet" emptyCause="none">
        <ul className="adm-queue" aria-label="Top terms">
          {terms.map(([term, count], i) => (
            <li key={term} className="adm-srow">
              <span className="adm-srow-main">
                <span className={`adm-rank${i < 3 ? ' adm-rank--top' : ''}`}>{i + 1}</span>
                {term}
              </span>
              <span className="adm-num adm-srow-count">{count}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="searches-recent-h" title="Recent searches" subtitle="Latest search activity from users"
        noun="recent searches" query={query} isEmpty={recent.length === 0}
        emptyIcon={<Clock size={40} strokeWidth={1.5} />} emptyText="No recent searches" emptyCause="none">
        <ul className="adm-queue" aria-label="Recent searches">
          {recent.map(r => (
            <li key={r.id} className="adm-srow">
              <span className="adm-srow-main adm-srow-stack">
                <span>{r.query}</span>
                <span className="adm-note">{r.category} · {userOf(r)}</span>
              </span>
              <span className={`adm-sev ${r.found ? 'adm-sev--ok' : 'adm-sev--urgent'}`}>
                {r.found ? `${r.results_count} found` : 'none'}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
