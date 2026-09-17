import { CheckCircle, XCircle, Trash2, Download, X } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { useModerationStore } from '../stores/moderationStore'

export default function BulkActionBar({ onApprove, onReject, onDelete, onExport }) {
  const selectedIds = useModerationStore((s) => s.selectedIds)
  const clearSelection = useModerationStore((s) => s.clearSelection)
  const bulkActionLoading = useModerationStore((s) => s.bulkActionLoading)

  if (selectedIds.size === 0) return null

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: theme.space[3],
        padding: `${theme.space[3]} ${theme.space[5]}`,
        background: theme.navy,
        borderRadius: theme.radius.lg,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.2)',
        marginBottom: theme.space[4],
      }}
    >
      <span
        style={{
          fontSize: theme.type.bodySm.size,
          fontWeight: 700,
          color: 'var(--color-surface)',
          marginRight: 'auto',
        }}
      >
        {selectedIds.size} selected
      </span>

      <button
        onClick={onApprove}
        disabled={bulkActionLoading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          background: theme.success,
          color: '#fff',
          border: 'none',
          borderRadius: theme.radius.sm,
          fontSize: 12,
          fontWeight: 700,
          cursor: bulkActionLoading ? 'not-allowed' : 'pointer',
          opacity: bulkActionLoading ? 0.5 : 1,
        }}
      >
        <CheckCircle size={14} /> Approve
      </button>

      <button
        onClick={onReject}
        disabled={bulkActionLoading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          background: theme.warning,
          color: '#fff',
          border: 'none',
          borderRadius: theme.radius.sm,
          fontSize: 12,
          fontWeight: 700,
          cursor: bulkActionLoading ? 'not-allowed' : 'pointer',
          opacity: bulkActionLoading ? 0.5 : 1,
        }}
      >
        <XCircle size={14} /> Reject
      </button>

      <button
        onClick={onDelete}
        disabled={bulkActionLoading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          background: theme.danger,
          color: '#fff',
          border: 'none',
          borderRadius: theme.radius.sm,
          fontSize: 12,
          fontWeight: 700,
          cursor: bulkActionLoading ? 'not-allowed' : 'pointer',
          opacity: bulkActionLoading ? 0.5 : 1,
        }}
      >
        <Trash2 size={14} /> Delete
      </button>

      {onExport && (
        <button
          onClick={onExport}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.15)',
            color: 'var(--color-surface)',
            border: 'none',
            borderRadius: theme.radius.sm,
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Download size={14} /> Export
        </button>
      )}

      <button
        onClick={clearSelection}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          background: 'rgba(255,255,255,0.1)',
          color: 'var(--color-surface)',
          border: 'none',
          borderRadius: '50%',
          cursor: 'pointer',
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
