import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button, DataTable, Empty } from '@care-ecosystem/design-system/components/ui'
import ReviewDrawer from '../ui/ReviewDrawer.jsx'
import { timeAgo } from '../ui'
import { useReconciliationFindings, useReconciliationActions } from '../hooks/useReconciliation'
import { useAdmin } from '../provider/AdminProvider.jsx'
import '../ui/admin.css'

// What the money checks found (reconciliation_findings). The server runs the
// checks and keeps the findings; a person can acknowledge a finding (silences
// reminders), dismiss one with a note explaining why (it is never reopened), or
// reopen one. Nothing here changes any money: it only records decisions about
// what the checks reported. Ported from tabs/ReconciliationTab.jsx with the same
// decisions, conditions and wording; the only server calls are the three
// reconciliation actions, made by hooks/useReconciliation.js.
// This is not built on DirectoryTable: that component always renders a search
// box and a pager, and this list has neither (the server returns one list per
// status, unpaged).

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
]
const STATUS_LABEL = Object.fromEntries(FILTERS.map(f => [f.value, f.label]))
const SEVERITY = {
  critical: { label: 'Critical', tone: 'urgent' },
  warning: { label: 'Warning', tone: 'warning' },
  info: { label: 'Info', tone: 'info' },
}
const MIN_NOTE = 5
const UNRESOLVED = ['open', 'acknowledged']

const kindText = (f) => (f.kind || '').replace(/_/g, ' ')
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '')
const isCritical = (f) => f.severity === 'critical' && UNRESOLVED.includes(f.status)

function Severity({ value }) {
  const sev = SEVERITY[value] || SEVERITY.info
  return <span className={`adm-sev adm-sev--${sev.tone}`}>{sev.label}</span>
}

const columns = [
  { key: 'kind', label: 'Finding', render: f => <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{kindText(f)}</span> },
  { key: 'severity', label: 'Severity', render: f => <Severity value={f.severity} /> },
  { key: 'status', label: 'Status', render: f => STATUS_LABEL[f.status] || f.status || '—' },
  {
    key: 'source', label: 'Source / subject',
    render: f => <span style={{ overflowWrap: 'anywhere' }}>{f.source} · {f.subject_type} · <span style={{ fontFamily: 'monospace' }}>{f.subject_id}</span></span>,
  },
  { key: 'last_seen_at', label: 'Last seen', render: f => (f.last_seen_at ? timeAgo(f.last_seen_at) : '—') },
]

function FindingBody({ f }) {
  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Severity</dt><dd><Severity value={f.severity} /></dd>
        <dt>Source</dt><dd>{f.source || '—'}</dd>
        <dt>Subject type</dt><dd>{f.subject_type || '—'}</dd>
        <dt>Subject id</dt><dd style={{ fontFamily: 'monospace' }}>{f.subject_id || '—'}</dd>
        {f.note ? <><dt>Note</dt><dd>{f.note}</dd></> : null}
      </dl>
      <p className="adm-drawer-text" style={{ margin: '0 0 12px' }}>{f.detail}</p>
      <p className="adm-note">First seen {when(f.first_seen_at)} · last seen {when(f.last_seen_at)} · seen {f.occurrences}×</p>
    </>
  )
}

// The decisions, offered under exactly the legacy conditions. Keyed by finding
// id by the caller, so a half-written dismissal note never carries over to
// another finding; a failed dismissal keeps the note so it can be sent again.
function FindingDecisions({ f, busy, onDecide }) {
  const [dismissing, setDismissing] = useState(false)
  const [note, setNote] = useState('')
  const noteOk = note.trim().length >= MIN_NOTE
  const cancel = () => { setDismissing(false); setNote('') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {f.status === 'open' && (
          <Button variant="primary" disabled={busy} onClick={() => onDecide('acknowledge')}>Acknowledge</Button>
        )}
        {UNRESOLVED.includes(f.status) && (
          <Button variant="ghost" disabled={busy} onClick={() => { setDismissing(true); setNote('') }}>Dismiss…</Button>
        )}
        {['resolved', 'dismissed', 'acknowledged'].includes(f.status) && (
          <Button variant="ghost" disabled={busy} onClick={() => onDecide('reopen')}>Reopen</Button>
        )}
      </div>
      {dismissing && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (!busy && noteOk) onDecide('dismiss', note.trim()) }}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <label htmlFor={`money-note-${f.id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--adm-ink)' }}>
            Why is this explained? (kept on the record)
          </label>
          <textarea
            id={`money-note-${f.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            className="adm-focus"
            style={{ padding: 10, borderRadius: 8, border: '1px solid var(--adm-line)', background: 'var(--adm-panel)', color: 'var(--adm-ink)', font: 'inherit', fontSize: 13, resize: 'vertical' }}
          />
          <p className="adm-note">At least {MIN_NOTE} characters.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="submit" variant="danger" disabled={busy || !noteOk}>Dismiss finding</Button>
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function MoneyChecksSection() {
  const [status, setStatus] = useState('open')
  const query = useReconciliationFindings(status)
  const { data, isLoading, isError, isFetching, refetch } = query
  const rows = useMemo(() => data || [], [data])
  const ready = !isLoading && !isError
  const { busyId, running, updateFinding, runNow } = useReconciliationActions()
  const { confirming, showToast } = useAdmin()
  const [summary, setSummary] = useState('')

  // The opened finding is kept as a snapshot, so the drawer survives a refresh
  // (including one that drops the row). While the row is in the list the drawer
  // renders its fresh data, so the decisions offered follow its latest status.
  const [opened, setOpened] = useState(null)
  const [error, setError] = useState('')
  const fresh = opened == null ? null : rows.find(r => r.id === opened.id) || null
  useEffect(() => { if (fresh && fresh !== opened) setOpened(fresh) }, [fresh, opened])
  const current = fresh || opened
  // The id of the finding on screen, so a late decision result for a finding
  // whose drawer was closed (or replaced) is not shown on another one. A late
  // success needs nothing (the hook has refreshed and toasted); a late failure
  // is toasted, so it is never lost.
  const shownId = useRef(null)
  const open = (f) => { shownId.current = f.id; setError(''); setOpened(f) }
  const close = () => { shownId.current = null; setOpened(null); setError('') }

  const decide = async (f, op, note) => {
    const res = await updateFinding({ id: f.id, op, note })
    const message = res.ok ? null : `Couldn't update the finding: ${res.error}`
    if (shownId.current !== f.id) {
      if (message) showToast(message, { type: 'error' })
      return
    }
    if (res.ok) close()
    else setError(message)
  }

  const run = async () => {
    setSummary('')
    const res = await runNow()
    if (res.ok) setSummary(res.summary)
  }

  const critical = rows.filter(isCritical).length

  return (
    <div className="adm-page">
      <div className="adm-head">
        <div style={{ minWidth: 0 }}>
          <h1>Money Checks</h1>
          <p className="adm-note" style={{ marginTop: 4 }}>Differences found between our books, the payment engines and Paystack</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="ghost" size="sm" disabled={isFetching} onClick={() => refetch()} aria-label="Refresh findings"
            leftIcon={<RefreshCw size={14} aria-hidden="true" />}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" disabled={running} onClick={run}
            leftIcon={<Play size={14} aria-hidden="true" />}>
            {running ? 'Running…' : 'Run checks now'}
          </Button>
        </div>
      </div>

      <div>
        {/* Always mounted, so screen readers hear the summary when it arrives. */}
        <div role="status" aria-live="polite" className="adm-note" style={{ marginBottom: summary ? 12 : 0 }}>{summary}</div>
        <div role="tablist" aria-label="Finding status" className="adm-tabs" style={{ marginBottom: 12 }}>
          {FILTERS.map(opt => (
            <button key={opt.value} type="button" role="tab" aria-selected={status === opt.value}
              className="adm-btn-reset adm-tab" onClick={() => setStatus(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>

        {ready && status === 'open' && critical > 0 && (
          <div role="alert" className="adm-drawer-error" style={{ fontWeight: 600 }}>
            {critical} critical finding{critical === 1 ? '' : 's'} need a decision.
          </div>
        )}

        <DataTable
          rows={rows}
          columns={columns}
          loading={isLoading}
          error={isError ? "Couldn't load the findings." : undefined}
          onRetry={() => refetch()}
          count={ready ? `${rows.length} finding${rows.length === 1 ? '' : 's'}` : undefined}
          empty={(
            <Empty icon={<ShieldCheck size={28} aria-hidden="true" />}
              message={status === 'open' ? 'Nothing needs attention. Every check agrees.' : `No ${status} findings`}
              cause={status === 'open' ? 'positive' : 'none'} />
          )}
          onRowClick={open}
          actions={(f) => (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); open(f) }} aria-label={`Review ${kindText(f)}`}>
              Review
            </Button>
          )}
        />
      </div>

      <ReviewDrawer
        show={!!current}
        title={current ? kindText(current) : ''}
        status={current?.status}
        onClose={close}
        error={error}
        preventClose={confirming}
        footer={current ? (
          <FindingDecisions key={current.id} f={current} busy={busyId === current.id}
            onDecide={(op, note) => decide(current, op, note)} />
        ) : null}
      >
        {current ? <FindingBody f={current} /> : null}
      </ReviewDrawer>
    </div>
  )
}
