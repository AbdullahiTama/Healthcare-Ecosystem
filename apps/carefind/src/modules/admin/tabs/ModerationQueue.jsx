import { useState, useMemo } from 'react'
import { AlertTriangle, Filter, CheckSquare, Square } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, Button, Empty } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, timeAgo } from '../ui'
import { getModerationItems } from '../lib/priorityScoring'
import { useModerationStore } from '../stores/moderationStore'
import PriorityBadge from '../components/PriorityBadge'
import { BulkActionBar } from '../components/BulkActionBar'
import { callAdminAuth } from '../adminApi'

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'report', label: 'Reports' },
  { value: 'post', label: 'Flagged Posts' },
  { value: 'verification', label: 'Verifications' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function ModerationQueue({ reports, posts, verifications, showToast, loadAll }) {
  const {
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    bulkActionLoading,
    setBulkActionLoading,
    filterPriority,
    setFilterPriority,
    filterSource,
    setFilterSource,
  } = useModerationStore()

  const [confirmDelete, setConfirmDelete] = useState(false)

  const items = useMemo(
    () => getModerationItems({ reports, posts, verifications }),
    [reports, posts, verifications]
  )

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchPriority = filterPriority === 'all' || item.priority === filterPriority;
      const matchSource = filterSource === 'all' || item.source === filterSource;
      return matchPriority && matchSource;
    });
  }, [items, filterPriority, filterSource])

  const filteredIds = filtered.map((i) => i.id)

  function handleSelectAll() {
    if (selectedIds.size === filteredIds.length) {
      clearSelection()
    } else {
      selectAll(filteredIds)
    }
  }

  async function logAudit(action, targetType, targetId, metadata = {}) {
    try {
      await callAdminAuth('log_audit_action', {
        token: localStorage.getItem('admin_token'),
        auditAction: action,
        targetType,
        targetId,
        metadata,
      })
    } catch { /* non-blocking */ }
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return
    setBulkActionLoading(true)
    let approved = 0
    let skipped = 0
    try {
      const token = localStorage.getItem('admin_token')
      const itemsToApprove = items.filter((i) => selectedIds.has(i.id))
      for (const item of itemsToApprove) {
        try {
          if (item.source === 'verification') {
            await callAdminAuth('approve_verification', { token, id: item.id, userId: item.target_id, profession: item.raw.profession })
            await logAudit('approve', 'verification', item.id, { userId: item.target_id })
            approved++
          } else if (item.source === 'report') {
            await callAdminAuth('resolve_report', { token, id: item.id })
            await logAudit('resolve', 'report', item.id, {})
            approved++
          } else {
            skipped++
          }
        } catch { skipped++ }
      }
      clearSelection()
      loadAll()
      const msg = skipped > 0 ? `Approved ${approved}, skipped ${skipped} (posts cannot be approved)` : `Approved ${approved} items`
      showToast(msg, { type: skipped > 0 ? 'warning' : 'success' })
    } catch (err) {
      showToast(`Bulk approve failed: ${err.message}`, { type: 'error' })
    }
    setBulkActionLoading(false)
  }

  async function handleBulkReject() {
    if (selectedIds.size === 0) return
    setBulkActionLoading(true)
    let rejected = 0
    let skipped = 0
    try {
      const token = localStorage.getItem('admin_token')
      const itemsToReject = items.filter((i) => selectedIds.has(i.id))
      for (const item of itemsToReject) {
        try {
          if (item.source === 'verification') {
            await callAdminAuth('reject_verification', { token, id: item.id })
            await logAudit('reject', 'verification', item.id, {})
            rejected++
          } else if (item.source === 'report') {
            await callAdminAuth('resolve_report', { token, id: item.id })
            await logAudit('resolve', 'report', item.id, {})
            rejected++
          } else {
            skipped++
          }
        } catch { skipped++ }
      }
      clearSelection()
      loadAll()
      const msg = skipped > 0 ? `Rejected ${rejected}, skipped ${skipped} (posts cannot be rejected)` : `Rejected ${rejected} items`
      showToast(msg, { type: skipped > 0 ? 'warning' : 'success' })
    } catch (err) {
      showToast(`Bulk reject failed: ${err.message}`, { type: 'error' })
    }
    setBulkActionLoading(false)
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setConfirmDelete(true)
  }

  async function confirmBulkDelete() {
    setConfirmDelete(false)
    setBulkActionLoading(true)
    let deleted = 0
    let skipped = 0
    try {
      const token = localStorage.getItem('admin_token')
      const itemsToDelete = items.filter((i) => selectedIds.has(i.id))
      for (const item of itemsToDelete) {
        try {
          if (item.source === 'report' || item.source === 'post') {
            await callAdminAuth('delete_post', { token, id: item.target_id })
            await logAudit('delete', 'post', item.target_id, { reason: item.source === 'report' ? 'reported content' : 'flagged content' })
            deleted++
          } else {
            skipped++
          }
        } catch { skipped++ }
      }
      clearSelection()
      loadAll()
      const msg = skipped > 0 ? `Deleted ${deleted}, skipped ${skipped} (verifications cannot be deleted)` : `Deleted ${deleted} items`
      showToast(msg, { type: skipped > 0 ? 'warning' : 'success' })
    } catch (err) {
      showToast(`Bulk delete failed: ${err.message}`, { type: 'error' })
    }
    setBulkActionLoading(false)
  }

  const inputStyle = {
    padding: '6px 10px',
    fontSize: 12,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius.sm,
    background: theme.bg,
    color: theme.textDark,
    outline: 'none',
  };

  return (
    <div>
      <AdminPageHeader
        title="Moderation Queue"
        subtitle="Unified view of all pending content"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <AlertTriangle size={18} color={theme.warning} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {items.filter((i) => i.status === 'pending' || i.status === 'flagged').length} pending
          </span>
        </div>
      </AdminPageHeader>

      <Card style={{ padding: theme.space[4], marginBottom: theme.space[5] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], flexWrap: 'wrap' }}>
          <Filter size={14} color={theme.gray500} />
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            style={inputStyle}
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            style={inputStyle}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={handleSelectAll}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.sm,
              color: theme.textMid,
              cursor: 'pointer',
            }}
          >
            {selectedIds.size === filteredIds.length && filteredIds.length > 0
              ? <CheckSquare size={14} />
              : <Square size={14} />
            }
            Select all
          </button>
        </div>
      </Card>

      {confirmDelete && (
        <Card style={{ padding: theme.space[5], marginBottom: theme.space[5], borderColor: theme.danger, background: theme.dangerBg }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: theme.type.body.size, color: theme.danger, marginBottom: 4 }}>
                Delete {selectedIds.size} items?
              </div>
              <div style={{ fontSize: theme.type.caption.size, color: theme.textMid }}>
                This action cannot be undone. Posts will be permanently removed.
              </div>
            </div>
            <div style={{ display: 'flex', gap: theme.space[3] }}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" onClick={confirmBulkDelete}>Delete All</Button>
            </div>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Empty
          icon={<AlertTriangle size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="No items in moderation queue"
          cause="none"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
          {filtered.map((item) => (
            <Card
              key={item.id}
              style={{
                padding: theme.space[4],
                borderColor: selectedIds.has(item.id) ? theme.tealBright : theme.border,
                background: selectedIds.has(item.id) ? theme.tealMist : theme.cardBg,
                transition: `border-color ${theme.motion.fast}`,
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'flex-start', gap: theme.space[3] }}
              >
                <button
                  onClick={() => toggleSelect(item.id)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: `2px solid ${selectedIds.has(item.id) ? theme.tealDeep : theme.gray300}`,
                    background: selectedIds.has(item.id) ? theme.tealDeep : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                    padding: 0,
                  }}
                >
                  {selectedIds.has(item.id) && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        color: theme.tealDeep,
                        background: theme.tealMist,
                        padding: '2px 6px',
                        borderRadius: theme.radius.full,
                      }}
                    >
                      {item.source}
                    </span>
                    <PriorityBadge priority={item.priority} score={item.score} />
                    <span style={{ fontSize: theme.type.caption.size, color: theme.textLight }}>
                      {timeAgo(item.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: theme.type.body.size, fontWeight: 700, color: theme.textDark, marginBottom: 2 }}>
                    {item.title}
                  </div>
                  {item.description && (
                    <div style={{ fontSize: theme.type.caption.size, color: theme.textMid, lineHeight: 1.4 }}>
                      {item.description}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BulkActionBar
        onApprove={handleBulkApprove}
        onReject={handleBulkReject}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}
