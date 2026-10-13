import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@care-ecosystem/design-system/components/ui'
import DirectoryTable from '../ui/DirectoryTable.jsx'
import { DateRange, FilterPills, exportCSV, timeAgo } from '../ui'
import { useAuditLog } from '../hooks/useAuditLog'

const NO_FILTERS = { action: 'all', targetType: 'all', dateFrom: '', dateTo: '', page: 0 }
const EXCERPT_LENGTH = 60

// The verbs and target types the admin hooks record. A verb not listed here is
// still visible under "All".
const ACTION_OPTIONS = [
  { value: 'all', label: 'All actions' },
  { value: 'approve', label: 'Approved' },
  { value: 'reject', label: 'Rejected' },
  { value: 'delete', label: 'Deleted' },
  { value: 'suspend', label: 'Suspended' },
  { value: 'resolve', label: 'Resolved' },
  { value: 'bulk_delete', label: 'Bulk Delete' },
  { value: 'bulk_approve', label: 'Bulk Approve' },
  { value: 'bulk_reject', label: 'Bulk Reject' },
]
const TARGET_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'post', label: 'Posts' },
  { value: 'user', label: 'Users' },
  { value: 'verification', label: 'Verifications' },
  { value: 'claim', label: 'Claims' },
  { value: 'news', label: 'News' },
  { value: 'report', label: 'Reports' },
]

const actorOf = (log) => (typeof log.actor_name === 'string' && log.actor_name ? log.actor_name : 'Unknown')
const validDate = (value) => !!value && !Number.isNaN(new Date(value).getTime())
// '' for anything that is not a string (a malformed row never crashes).
const actionOf = (log) => (typeof log.action === 'string' ? log.action.replace(/_/g, ' ') : '')
const targetOf = (log) => (typeof log.target_type === 'string' ? log.target_type : '')

// danger / success / warning / info, as the legacy screen coloured them.
function dotTone(action) {
  if (action === 'delete' || action === 'suspend' || action === 'bulk_delete') return 'danger'
  if (action === 'approve' || action === 'bulk_approve') return 'success'
  if (action === 'reject' || action === 'bulk_reject') return 'warning'
  return 'info'
}

// Metadata is always shown as text: a string as is, anything else as pretty
// JSON. '' when nothing was recorded.
function metaText(metadata, pretty) {
  if (metadata == null || metadata === '') return ''
  if (typeof metadata === 'string') return metadata
  try { return JSON.stringify(metadata, null, pretty ? 2 : undefined) ?? '' } catch { return '' }
}
const excerptOf = (log) => {
  const text = metaText(log.metadata, false).replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
}

const columns = [
  { key: 'created_at', label: 'Time', render: log => (validDate(log.created_at) ? timeAgo(log.created_at) : '—') },
  { key: 'actor_name', label: 'Actor', render: log => actorOf(log) },
  {
    key: 'action',
    label: 'Action',
    render: log => (
      <span className="adm-audit-action">
        <span className={`adm-audit-dot adm-audit-dot--${dotTone(log.action)}`} aria-hidden="true" />
        {actionOf(log) || '—'}
      </span>
    ),
  },
  { key: 'target_type', label: 'Target', render: log => targetOf(log) || '—' },
  { key: 'metadata', label: 'Details', render: log => excerptOf(log) || '—' },
]

// One flat record per row for the CSV: the shared exportCSV cannot quote an
// object cell, so metadata goes out as a single-line string.
const csvRecord = (log) => ({
  time: log.created_at ?? null,
  actor: actorOf(log),
  action: typeof log.action === 'string' ? log.action : '',
  target_type: targetOf(log),
  target_id: log.target_id == null ? null : String(log.target_id),
  details: metaText(log.metadata, false).replace(/\s+/g, ' ').trim(),
})

const rowLabel = (log) => `${actorOf(log)} ${actionOf(log)}`.trim()

function AuditBody({ log }) {
  const details = metaText(log.metadata, true)
  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Actor</dt><dd>{actorOf(log)}</dd>
        <dt>Action</dt><dd>{actionOf(log) || '—'}</dd>
        <dt>Target</dt><dd>{targetOf(log) || '—'}</dd>
        {log.target_id != null && log.target_id !== '' && (<><dt>Target id</dt><dd>{String(log.target_id)}</dd></>)}
        <dt>When</dt><dd>{validDate(log.created_at) ? `${timeAgo(log.created_at)} (${new Date(log.created_at).toLocaleString()})` : '—'}</dd>
      </dl>
      <section>
        <h3 className="adm-audit-heading">Details</h3>
        {details
          ? <pre className="adm-drawer-text adm-audit-pre">{details}</pre>
          : <p className="adm-note">No details recorded</p>}
      </section>
    </>
  )
}

export default function AuditLogSection() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const [actor, setActor] = useState('')
  const { action, targetType, dateFrom, dateTo, page } = filters
  // A server filter change always returns to the first page; an unchanged value is a no-op.
  const update = (patch) => setFilters(prev => (
    Object.keys(patch).every(k => prev[k] === patch[k]) ? prev : { ...prev, ...patch, page: 0 }
  ))
  // DirectoryTable mirrors the actor search going to '' into its box.
  const clear = () => { setFilters(NO_FILTERS); setActor('') }

  const query = useAuditLog({ action, targetType, dateFrom, dateTo, page })

  // The actor filter is client-side over the loaded page: the table reads
  // query.data.rows, so it gets a derived query whose rows are narrowed
  // (hasNext and the rest are kept, so paging still follows the server).
  const needle = actor.trim().toLowerCase()
  const shown = useMemo(() => {
    const rows = query.data?.rows
    if (!rows || !needle) return query
    return { ...query, data: { ...query.data, rows: rows.filter(log => actorOf(log).toLowerCase().includes(needle)) } }
  }, [query, needle])
  const rows = shown.data?.rows || []
  // Rows were loaded but the actor filter hid them all: say so, instead of the
  // table's "no entries" / "none on this page", which would be false.
  const actorMiss = !!needle && (query.data?.rows?.length || 0) > 0 && rows.length === 0

  const renderDrawer = (log) => ({
    title: `${actionOf(log) || 'Action'} · ${targetOf(log) || 'unknown target'}`,
    body: <AuditBody key={log.id} log={log} />,
  })

  return (
    <DirectoryTable
      title="Audit log"
      noun="audit log entry"
      plural="audit log entries"
      query={shown}
      columns={columns}
      search={actor}
      onSearch={setActor}
      searchPlaceholder="Filter loaded rows by actor…"
      filters={(
        <>
          <p className="adm-note">Filters the rows loaded</p>
          <FilterPills label="Action" options={ACTION_OPTIONS} value={action} onChange={(v) => update({ action: v })} />
          <FilterPills label="Target type" options={TARGET_OPTIONS} value={targetType} onChange={(v) => update({ targetType: v })} />
          <div role="group" aria-label="Date range" className="adm-audit-dates">
            <DateRange from={dateFrom} to={dateTo}
              onFrom={(v) => update({ dateFrom: v })} onTo={(v) => update({ dateTo: v })} />
          </div>
          {query.data?.capped && <p className="adm-note">Showing the newest 200 entries</p>}
        </>
      )}
      filtersActive={!!(needle || action !== 'all' || targetType !== 'all' || dateFrom || dateTo)}
      onClear={clear}
      page={page}
      onPage={(n) => setFilters(prev => ({ ...prev, page: n }))}
      renderDrawer={renderDrawer}
      rowLabel={rowLabel}
      emptyNote={actorMiss ? 'No entries on this page match this actor. Try Next or Previous, or clear the actor filter.' : undefined}
      toolbar={(
        <Button variant="ghost" size="sm" leftIcon={<Download size={14} aria-hidden="true" />}
          disabled={rows.length === 0 || query.isPlaceholderData}
          onClick={() => exportCSV(rows.map(csvRecord), 'audit_log_page.csv')}>
          Export CSV
        </Button>
      )}
    />
  )
}
