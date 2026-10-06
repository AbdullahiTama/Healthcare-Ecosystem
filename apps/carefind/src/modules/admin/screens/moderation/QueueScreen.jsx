import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import { DataTable, Empty, FilterBar, Pill } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { contentRepository } from '../../repositories/contentRepository'
import { getModerationItems } from '../../lib/priorityScoring'
import { useAdminToast, useAdminConfirm, useAuditLog } from '../../AdminFeedback.jsx'
import { pathFor } from '../../navigation'
import PriorityBadge from '../../components/PriorityBadge'
import { BulkActionBar } from '../../components/BulkActionBar'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { primaryCell, selectionColumn } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { source: 'all', priority: 'all' }
const SOURCE_LABEL = { report: 'Report', post: 'Flagged post', verification: 'Verification' }
const SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'report', label: 'Reports' },
  { value: 'post', label: 'Flagged posts' },
  { value: 'verification', label: 'Verifications' },
]
const PRIORITIES = ['all', 'urgent', 'high', 'medium', 'low'].map(p => ({ value: p, label: p === 'all' ? 'All priorities' : p }))

export default function QueueScreen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const askConfirm = useAdminConfirm()
  const audit = useAuditLog()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [working, setWorking] = useState(false)

  const reportsQ = useQueue('reports')
  const verifsQ = useQueue('verifications')
  const postsQ = useQuery({ queryKey: ['admin', 'queue-posts'], queryFn: () => contentRepository.getPosts({ limit: 50 }), staleTime: 15000 })

  const items = useMemo(
    () => getModerationItems({ reports: reportsQ.data || [], posts: postsQ.data || [], verifications: verifsQ.data || [] }),
    [reportsQ.data, postsQ.data, verifsQ.data],
  )
  const filtered = useMemo(
    () => items.filter(i => (f.source === 'all' || i.source === f.source) && (f.priority === 'all' || i.priority === f.priority)),
    [items, f.source, f.priority],
  )

  const isLoading = reportsQ.isLoading || verifsQ.isLoading
  const listError = reportsQ.error || verifsQ.error
  const retry = () => { reportsQ.refetch(); verifsQ.refetch(); postsQ.refetch() }

  const toggle = (id) => setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAll = () => setSelectedIds(prev => (filtered.length > 0 && filtered.every(i => prev.has(i.id)) ? new Set() : new Set(filtered.map(i => i.id))))
  const clear = () => setSelectedIds(new Set())
  const chosen = () => items.filter(i => selectedIds.has(i.id))

  function openItem(item) {
    if (item.source === 'verification') navigate(`${pathFor('verifications')}?id=${encodeURIComponent(item.id)}`)
    else if (item.source === 'report') navigate(`${pathFor('reports')}?id=${encodeURIComponent(item.raw.id)}`)
    else navigate(pathFor('posts'))
  }

  // Runs one call per selected item. An item that does not apply to the
  // action, or whose call fails, is counted as skipped and the rest continue.
  async function runBulk(perItem, summarise) {
    if (working) return
    setWorking(true)
    let done = 0
    let skipped = 0
    for (const item of chosen()) {
      try {
        if (await perItem(item)) done += 1
        else skipped += 1
      } catch {
        skipped += 1
      }
    }
    clear()
    setWorking(false)
    qc.invalidateQueries({ queryKey: ['admin'] })
    showToast(summarise(done, skipped), { type: skipped > 0 ? 'warning' : 'success' })
  }

  const tally = (verb) => (done, skipped) => (skipped > 0 ? `${verb} ${done}, skipped ${skipped}` : `${verb} ${done} items`)

  const bulkApprove = () => runBulk(async (item) => {
    if (item.source === 'verification') {
      await callAdminAuth('approve_verification', { id: item.id, userId: item.target_id, profession: item.raw.profession })
      audit('approve', 'verification', item.id, { userId: item.target_id })
      return true
    }
    if (item.source === 'report') {
      await callAdminAuth('resolve_report', { id: item.raw.id })
      audit('resolve', 'report', item.raw.id, {})
      return true
    }
    return false
  }, tally('Approved'))

  const bulkReject = () => runBulk(async (item) => {
    if (item.source === 'verification') {
      await callAdminAuth('reject_verification', { id: item.id })
      audit('reject', 'verification', item.id, {})
      return true
    }
    if (item.source === 'report') {
      await callAdminAuth('resolve_report', { id: item.raw.id })
      audit('resolve', 'report', item.raw.id, {})
      return true
    }
    return false
  }, tally('Rejected'))

  function bulkDelete() {
    const deletable = chosen().filter(i => (i.source === 'report' || i.source === 'post') && i.target_id)
    if (deletable.length === 0) {
      showToast('Only posts can be deleted. Nothing selected is a post.', { type: 'warning' })
      return
    }
    askConfirm({
      title: `Delete ${deletable.length} ${deletable.length === 1 ? 'post' : 'posts'}?`,
      consequence: 'This permanently deletes the selected posts along with their likes and comments. Selected verifications are left untouched. This cannot be undone.',
      confirmLabel: 'Delete',
      action: () => runBulk(async (item) => {
        if ((item.source !== 'report' && item.source !== 'post') || !item.target_id) return false
        await callAdminAuth('delete_post', { id: item.target_id })
        audit('delete', 'post', item.target_id, { reason: item.source === 'report' ? 'reported content' : 'flagged content' })
        return true
      }, (done, skipped) => (skipped > 0 ? `Deleted ${done}, skipped ${skipped}` : `Deleted ${done} ${done === 1 ? 'post' : 'posts'}`)),
    })
  }

  const columns = [
    selectionColumn({ rows: filtered, selectedIds, onToggle: toggle, onToggleAll: toggleAll, rowLabel: i => i.title }),
    { key: 'title', label: 'Item', render: i => primaryCell({ title: i.title, sub: i.description, onOpen: () => openItem(i), openLabel: `Open ${i.title}` }) },
    { key: 'source', label: 'Type', sortable: true, render: i => <Pill label={SOURCE_LABEL[i.source] || i.source} type="teal" /> },
    { key: 'score', label: 'Priority', sortable: true, render: i => <PriorityBadge priority={i.priority} score={i.score} /> },
    { key: 'created_at', label: 'Waiting', sortable: true, sortValue: i => i.created_at || '', render: i => (i.created_at ? timeAgo(i.created_at) : '—') },
  ]

  return (
    <div>
      <AdminPageHeader title="Moderation queue" subtitle={`${items.length} ${items.length === 1 ? 'item needs' : 'items need'} review`} />

      <FilterBar label="Queue filters" style={{ marginBottom: theme.space[8] }}>
        <FilterPills value={f.source} onChange={(source) => setF({ source })} options={SOURCES} />
        <FilterPills value={f.priority} onChange={(priority) => setF({ priority })} options={PRIORITIES} />
      </FilterBar>

      {postsQ.error && (
        <p role="status" style={{ margin: `0 0 ${theme.space[6]}px`, fontSize: 12, color: theme.warning }}>Flagged posts could not be loaded.</p>
      )}

      <DataTable
        rows={filtered}
        columns={columns}
        loading={isLoading}
        error={listError ? 'The moderation queue could not be loaded.' : null}
        onRetry={retry}
        empty={<Empty icon={<Layers size={40} strokeWidth={1.5} color={theme.gray300} />} message="Nothing is waiting for review" />}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        onApprove={working ? undefined : bulkApprove}
        onReject={working ? undefined : bulkReject}
        onDelete={working ? undefined : bulkDelete}
        onClear={clear}
      />
    </div>
  )
}
