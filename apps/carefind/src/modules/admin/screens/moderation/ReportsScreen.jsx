import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Flag, Trash2 } from 'lucide-react'
import { Button, DataTable, Empty, FilterBar, SearchBar } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { useAdminToast, useAdminConfirm, useAdminActivity, useAuditLog } from '../../AdminFeedback.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { DetailDrawer, DetailField } from '../../ui/DetailDrawer.jsx'
import { StatusPill } from '../../ui/StatusPill.jsx'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { status: 'pending', q: '', id: '' }
const reasonOf = (r) => r.reason || 'No reason given'
const NO_POST = 'Post no longer available'
const excerpt = (r) => {
  const text = r.posts?.content
  if (!text) return NO_POST
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

export default function ReportsScreen() {
  const { data: rows = [], isLoading, error, refetch } = useQueue('reports')
  const [f, setF] = useUrlFilters(DEFAULTS)
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const askConfirm = useAdminConfirm()
  const { recordAction } = useAdminActivity()
  const audit = useAuditLog()
  const [busy, setBusy] = useState(null) // 'dismiss' | 'delete' | null

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    resolved: rows.filter(r => r.status !== 'pending').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows.filter(r => {
      if (f.status === 'pending' && r.status !== 'pending') return false
      if (f.status === 'resolved' && r.status === 'pending') return false
      if (!q) return true
      return [r.reason, r.posts?.content].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, f.status, f.q])

  const selected = f.id ? rows.find(r => String(r.id) === f.id) : null
  const open = (row) => setF({ id: row.id }, { replace: false })
  const close = () => setF({ id: null })
  // The record open right now. An action that finishes later closes the
  // drawer only if it is still showing the record that was acted on.
  const openId = useRef(f.id)
  openId.current = f.id
  const closeIf = (id) => { if (openId.current === String(id)) close() }
  const done = (id) => { closeIf(id); qc.invalidateQueries({ queryKey: ['admin'] }) }

  async function dismiss() {
    if (busy || !selected) return
    const record = selected
    setBusy('dismiss')
    try {
      await callAdminAuth('resolve_report', { id: record.id })
      audit('resolve', 'report', record.id, {})
      recordAction({ action: 'approve', target: 'report', id: record.id })
      showToast('Report dismissed', { type: 'success' })
      done(record.id)
    } catch (err) {
      showToast(`Couldn't dismiss the report: ${err.message}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  function deletePost() {
    if (busy || !selected?.post_id) return
    const report = selected
    askConfirm({
      title: 'Delete this post?',
      consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.',
      confirmLabel: 'Delete',
      action: async () => {
        setBusy('delete')
        try {
          await callAdminAuth('delete_post', { id: report.post_id })
          audit('delete', 'post', report.post_id, { reportId: report.id })
          recordAction({ action: 'reject', target: 'post', id: report.post_id })
          showToast('Post deleted', { type: 'success' })
          done(report.id)
        } catch (err) {
          showToast(`Couldn't delete the post: ${err.message}`, { type: 'error' })
        } finally {
          setBusy(null)
        }
      },
    })
  }

  const columns = [
    { key: 'reason', label: 'Reason', sortable: true, sortValue: r => reasonOf(r).toLowerCase(), render: r => primaryCell({ title: reasonOf(r), onOpen: () => open(r), openLabel: `Open report: ${reasonOf(r)}` }) },
    { key: 'post', label: 'Reported post', render: r => <span style={{ fontSize: 13, color: r.posts?.content ? theme.textMid : theme.textLight }}>{excerpt(r)}</span> },
    { key: 'created_at', label: 'Reported', sortable: true, sortValue: r => r.created_at || '', render: r => (r.created_at ? timeAgo(r.created_at) : '—') },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  const pending = selected?.status === 'pending'

  return (
    <div>
      <AdminPageHeader title="Reports" subtitle={`${counts.pending} pending · ${counts.all} loaded`} />

      <FilterBar label="Report filters" style={{ marginBottom: theme.space[8] }}>
        <SearchBar label="Search reports" value={f.q} onChange={(q) => setF({ q })} placeholder="Search reason or post text…" />
        <FilterPills
          value={f.status}
          onChange={(status) => setF({ status })}
          options={[
            { value: 'pending', label: `Pending ${counts.pending}` },
            { value: 'resolved', label: `Handled ${counts.resolved}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={open}
        loading={isLoading}
        error={error ? 'The reports could not be loaded.' : null}
        onRetry={refetch}
        empty={<Empty icon={<Flag size={40} strokeWidth={1.5} color={theme.gray300} />} message="No reports match these filters" />}
      />

      <DetailDrawer
        open={!!f.id && !isLoading}
        onClose={close}
        title={selected ? reasonOf(selected) : 'Report'}
        footer={pending ? (
          <>
            {selected.post_id && (
              <Button variant="danger" fullWidth leftIcon={<Trash2 size={14} />} onClick={deletePost} disabled={!!busy} loading={busy === 'delete'}>Delete post</Button>
            )}
            <Button variant="ghost" fullWidth leftIcon={<CheckCircle size={14} />} onClick={dismiss} disabled={!!busy} loading={busy === 'dismiss'}>Dismiss report</Button>
          </>
        ) : null}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>This report could not be found. It may already have been handled, or it is older than the 30 most recent reports.</p>
        ) : (
          <div>
            <DetailField label="Status"><StatusPill status={selected.status} /></DetailField>
            <DetailField label="Reported">{selected.created_at ? new Date(selected.created_at).toLocaleString() : null}</DetailField>
            <div style={{ marginTop: theme.space[8], fontSize: 12, fontWeight: 700, color: theme.textLight }}>Reported post</div>
            <p style={{ margin: `${theme.space[3]}px 0 0`, padding: theme.space[6], background: theme.bg, borderRadius: theme.radius.md, fontSize: 13.5, lineHeight: 1.55, color: selected.posts?.content ? theme.textDark : theme.textLight, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {selected.posts?.content || NO_POST}
            </p>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
