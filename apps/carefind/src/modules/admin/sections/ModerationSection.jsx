import { useEffect, useMemo, useState } from 'react'
import { Button, DataTable, Empty } from '@care-ecosystem/design-system/components/ui'
import ReviewDrawer from '../ui/ReviewDrawer.jsx'
import { timeAgo } from '../ui'
import '../ui/admin.css'
import { useTrustQueues, TRUST_CAPS } from '../hooks/useTrustQueues'
import { useReviewActions } from '../hooks/useReviewActions'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { useAdminData } from '../../../hooks/queries'
import { callAdminAuth } from '../adminApi'
import { isAllowed } from '../navigation'
import { getModerationItems } from '../lib/priorityScoring'
import { runBulk, summarizeBulk, reportsToResolve } from '../lib/bulkModeration'
import { useModerationStore } from '../stores/moderationStore'
import PriorityBadge from '../components/PriorityBadge'
import { BulkActionBar } from '../components/BulkActionBar'
import { VerificationBody } from './VerificationsSection.jsx'
import { ReportBody } from './ReportsSection.jsx'

// One queue across reports, flagged posts and pending verifications, ranked by
// priority, with a drawer per item and bulk actions. Every bulk action handles
// each item by its real type and names what it skipped or failed; a list that
// failed to load is shown as failed, never as an empty queue.

const SOURCE_LABEL = { report: 'Report', post: 'Flagged post', verification: 'Verification' }
const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'report', label: 'Reports' },
  { value: 'post', label: 'Flagged posts' },
  { value: 'verification', label: 'Verifications' },
]
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]
const NO_ROWS = []

// The visible name of an item, never blank.
const titleOf = (item) => item.title || 'Untitled'
// The accessible name of an item's checkbox and Review button. Titles repeat
// (two posts reported as "spam", or a report with no reason), so the source
// and the start of the summary are added to keep each name unique in practice.
function itemLabel(item) {
  const summary = item.description && item.description !== item.title ? `: ${item.description.slice(0, 40)}` : ''
  return `${titleOf(item)} (${SOURCE_LABEL[item.source] || item.source}${summary})`
}

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--adm-ink-soft)' }
const selectStyle = { height: 34, padding: '0 10px', border: '1px solid var(--adm-line)', borderRadius: 8, font: 'inherit', fontSize: 13, color: 'var(--adm-ink)', background: 'var(--adm-panel)' }
const checkStyle = { width: 16, height: 16, margin: 0, cursor: 'pointer', accentColor: 'var(--teal-deep, #0e6f5a)' }

// The audit trail must never block moderation, so a failed audit is swallowed.
async function audit(auditAction, targetType, targetId, metadata = {}) {
  try {
    await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
  } catch { /* an audit failure must not block moderation */ }
}

export default function ModerationSection() {
  const { data, refetch } = useTrustQueues(true)
  // The admin posts list swallows its own errors and returns [] (Phase 1
  // finding 3), so a failed load of flagged posts cannot be told apart from
  // "no flagged posts". Reports and verifications do report failure.
  const { data: adminData } = useAdminData(true)
  const actions = useReviewActions()
  const { askConfirm, confirming, showToast, invalidateAdmin, permissions } = useAdmin()
  // Every source is listed, as before, but an item's actions are offered only
  // when the role is allowed that item's own tab. This tidies the UI only: the
  // server decides what any request may do.
  const canAct = {
    verification: isAllowed(permissions, 'verifications'),
    report: isAllowed(permissions, 'reports'),
    post: isAllowed(permissions, 'posts'),
  }
  const anyBulk = canAct.verification || canAct.report || canAct.post
  const {
    selectedIds, toggleSelect, selectAll, clearSelection,
    bulkActionLoading, setBulkActionLoading,
    filterPriority, setFilterPriority, filterSource, setFilterSource,
  } = useModerationStore()

  const [openKey, setOpenKey] = useState(null)
  const [error, setError] = useState('')

  // Loading until every source has answered: the trust queues and the flagged
  // posts arrive separately, and showing "Nothing waiting" before the posts
  // land would claim a clear queue that is about to fill.
  const loading = !data || !adminData
  const reportsFailed = data?.reports?.status === 'error'
  const verificationsFailed = data?.verifications?.status === 'error'
  const anyFailed = reportsFailed || verificationsFailed
  const reports = data?.reports?.status === 'ok' ? data.reports.data : NO_ROWS
  const verifications = data?.verifications?.status === 'ok' ? data.verifications.data : NO_ROWS
  const posts = adminData?.posts || NO_ROWS
  const reportsCapped = reports.length >= TRUST_CAPS.reports

  // Only pending reports are waiting. Passing resolved ones would list them,
  // count them toward a post's priority, and could make a resolved report the
  // face of a post that still has pending ones.
  const items = useMemo(
    () => getModerationItems({ reports: reports.filter(r => r.status === 'pending'), posts, verifications }),
    [reports, posts, verifications],
  )
  const filtered = useMemo(() => items.filter(i =>
    (filterPriority === 'all' || i.priority === filterPriority) &&
    (filterSource === 'all' || i.source === filterSource),
  ), [items, filterPriority, filterSource])

  // A bulk action acts on what the admin can see selected: a row hidden by a
  // filter, or gone after a refresh, is never acted on unseen.
  const selected = useMemo(() => filtered.filter(i => selectedIds.has(i.id)), [filtered, selectedIds])
  const allSelected = filtered.length > 0 && selected.length === filtered.length

  const keyOf = (item) => `${item.source}:${item.id}`
  const current = openKey == null ? null : items.find(i => keyOf(i) === openKey) || null
  const openSource = openKey == null ? null : openKey.slice(0, openKey.indexOf(':'))
  const openSourceLoaded = openSource === 'report' ? data?.reports?.status === 'ok'
    : openSource === 'verification' ? data?.verifications?.status === 'ok'
      : !!adminData
  // The item was handled elsewhere (or the list refreshed without it). A failed
  // refresh keeps the drawer: only a loaded list that lacks the item closes it.
  const drawerGone = openKey != null && !current && openSourceLoaded
  useEffect(() => {
    if (drawerGone) { setOpenKey(null); setError('') }
  }, [drawerGone])

  const open = (item) => { setError(''); setOpenKey(keyOf(item)) }
  const close = () => { setOpenKey(null); setError('') }
  const finish = (res) => { if (res.ok) close(); else setError(res.error) }

  const runAction = async (action, verb) => {
    if (bulkActionLoading || selected.length === 0) return
    setBulkActionLoading(true)
    try {
      const result = await runBulk(action, selected, { reports, call: callAdminAuth, audit })
      const { message, type } = summarizeBulk(result, verb)
      showToast(message, { type })
    } finally {
      setBulkActionLoading(false)
      clearSelection()
      invalidateAdmin()
    }
  }

  const count = (source) => selected.filter(i => source.includes(i.source)).length
  const others = (n) => (selected.length - n > 0 ? ` ${selected.length - n} selected item${selected.length - n === 1 ? ' is' : 's are'} not affected and will be skipped.` : '')

  const onBulkReject = () => {
    const n = count(['verification'])
    askConfirm({
      title: `Reject ${n} verification request${n === 1 ? '' : 's'}?`,
      consequence: `The requests are marked as rejected and leave the pending list. Their profiles are not changed.${others(n)}`,
      confirmLabel: 'Reject verifications',
      action: () => runAction('reject_verifications', 'Rejected'),
    })
  }
  const onBulkDelete = () => {
    const n = count(['report', 'post'])
    askConfirm({
      title: `Delete ${n} post${n === 1 ? '' : 's'}?`,
      consequence: `This permanently deletes the posts along with their likes and comments. This cannot be undone.${others(n)}`,
      confirmLabel: 'Delete posts',
      action: () => runAction('delete_posts', 'Deleted'),
    })
  }

  const toggleAll = () => {
    if (allSelected) clearSelection()
    else selectAll(filtered.map(i => i.id))
  }

  const columns = [
    {
      key: 'select', label: 'Select',
      render: item => (
        <input type="checkbox" style={checkStyle} aria-label={`Select ${itemLabel(item)}`}
          checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
      ),
    },
    { key: 'priority', label: 'Priority', sortable: true, sortValue: i => i.score, render: i => <PriorityBadge priority={i.priority} score={i.score} /> },
    { key: 'source', label: 'Source', render: i => SOURCE_LABEL[i.source] || i.source },
    {
      key: 'summary', label: 'Summary',
      render: i => (
        <span>
          <span className="adm-item-title">{titleOf(i)}</span>
          {i.description && i.description !== i.title ? <span className="adm-item-sub">{i.description}</span> : null}
        </span>
      ),
    },
    { key: 'age', label: 'Age', sortable: true, sortValue: i => new Date(i.created_at).getTime(), render: i => timeAgo(i.created_at) },
  ]

  const deletePostButton = (postId) => (
    <Button variant="danger" fullWidth
      onClick={() => askConfirm({
        title: 'Delete this post?',
        consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.',
        confirmLabel: 'Delete post',
        action: async () => finish(await actions.deletePost(postId)),
      })}>
      Delete post
    </Button>
  )

  // The drawer shows the same body as the item's own screen, and its actions
  // only when the role is allowed that screen.
  const renderDrawer = (item) => {
    const view = renderItem(item)
    return canAct[item.source] ? view : { body: view.body, footer: null }
  }
  const renderItem = (item) => {
    if (item.source === 'verification') {
      const v = item.raw
      return {
        body: <VerificationBody v={v} actions={actions} setError={setError} />,
        footer: (
          <>
            <Button variant="primary" fullWidth loading={actions.busyId === item.id}
              onClick={async () => finish(await actions.approveVerification({ id: item.id, userId: item.target_id, profession: v.profession }))}>
              Approve
            </Button>
            <Button variant="danger" fullWidth
              onClick={() => askConfirm({
                title: `Reject ${v.full_name}'s verification?`,
                consequence: 'The request is marked as rejected and leaves the pending list. Their profile is not changed.',
                confirmLabel: 'Reject',
                action: async () => finish(await actions.rejectVerification(item.id)),
              })}>
              Reject
            </Button>
          </>
        ),
      }
    }
    if (item.source === 'report') {
      const pending = reportsToResolve(item, reports)
      // One item stands for every pending report on its post; dismiss them all,
      // each by its own report id, and stop at the first failure.
      const dismiss = async () => {
        if (pending.length === 0) { setError('Nothing left to dismiss on this post.'); return }
        for (const rep of pending) {
          const res = await actions.resolveReport(rep.id)
          if (!res.ok) { finish(res); return }
        }
        close()
      }
      return {
        body: <ReportBody r={item.raw} />,
        footer: (
          <>
            {item.target_id && item.raw.posts && deletePostButton(item.target_id)}
            <Button variant="secondary" fullWidth loading={pending.some(rep => actions.busyId === rep.id)} onClick={dismiss}>
              Dismiss
            </Button>
          </>
        ),
      }
    }
    const p = item.raw
    return {
      body: (
        <>
          <dl className="adm-drawer-grid">
            <dt>Status</dt><dd>{p.status || '—'}</dd>
            <dt>Reports</dt><dd className="adm-num">{p.report_count || 0}</dd>
            <dt>Posted</dt><dd>{timeAgo(p.created_at)}</dd>
          </dl>
          <div className="adm-drawer-text">{p.content || 'No text'}</div>
        </>
      ),
      footer: deletePostButton(item.target_id),
    }
  }
  const drawer = current ? renderDrawer(current) : null

  const filtersActive = filterPriority !== 'all' || filterSource !== 'all'
  const emptyMessage = anyFailed ? 'Nothing to show from the lists that loaded'
    : items.length > 0 && filtersActive ? 'Nothing matches these filters'
      : 'Nothing waiting'
  const empty = <Empty message={emptyMessage} cause={!anyFailed && items.length === 0 ? 'positive' : 'none'} />

  const banner = (what) => (
    <div role="alert" className="adm-notice adm-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span>Couldn&apos;t load {what}</span>
      <button type="button" className="adm-btn-reset adm-retry" onClick={() => refetch()}>Retry</button>
    </div>
  )

  return (
    <div className="adm-page" aria-busy={loading || bulkActionLoading || undefined}>
      <div className="adm-head">
        <h1>Moderation</h1>
        {!loading && <span className="adm-meta adm-num">{items.length}{reportsCapped ? '+' : ''} waiting</span>}
      </div>

      {reportsFailed && banner('reports')}
      {verificationsFailed && banner('verifications')}
      {reportsCapped && <p className="adm-note">The server returns at most {TRUST_CAPS.reports} reports, so there may be older reports not shown.</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <label style={fieldStyle}>
          Source
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)} style={selectStyle}>
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>
          Priority
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={selectStyle}>
            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {!loading && filtered.length > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, fontSize: 13, color: 'var(--adm-ink)', cursor: 'pointer' }}>
            <input type="checkbox" style={checkStyle} checked={allSelected}
              ref={el => { if (el) el.indeterminate = selected.length > 0 && !allSelected }}
              onChange={toggleAll} />
            Select all
          </label>
        )}
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        loading={loading}
        empty={empty}
        actions={(item) => (
          <Button size="sm" variant="ghost" onClick={() => open(item)} aria-label={`Review ${itemLabel(item)}`}>
            Review
          </Button>
        )}
      />

      <BulkActionBar
        selectedCount={anyBulk ? selected.length : 0}
        onApprove={canAct.verification ? () => runAction('approve_verifications', 'Approved') : undefined}
        onReject={canAct.verification ? onBulkReject : undefined}
        onDismiss={canAct.report ? () => runAction('dismiss_reports', 'Dismissed') : undefined}
        onDelete={canAct.post ? onBulkDelete : undefined}
        onClear={clearSelection}
        approveLabel="Approve verifications"
        rejectLabel="Reject verifications"
        dismissLabel="Dismiss reports"
        deleteLabel="Delete posts"
      />

      <ReviewDrawer show={!!current} title={current ? titleOf(current) : ''} status={current ? current.status : undefined} onClose={close} error={error} footer={drawer?.footer} preventClose={confirming}>
        {drawer?.body}
      </ReviewDrawer>
    </div>
  )
}
