export function BulkActionBar({ selectedCount, onApprove, onReject, onDismiss, onDelete, onClear, approveLabel = 'Approve selected', rejectLabel = 'Reject selected', dismissLabel = 'Dismiss selected', deleteLabel = 'Delete selected' }) {
  if (!selectedCount) return null
  return (
    <div style={{
      position: 'sticky',
      bottom: 12,
      zIndex: 5,
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      padding: '10px 14px',
      borderRadius: 12,
      background: 'var(--fg)',
      color: 'var(--bg)',
      boxShadow: 'var(--elevation-2)',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{selectedCount} selected</span>
      <div style={{ display: 'flex', gap: 8 }}>
        {onApprove && (
          <button onClick={onApprove} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {approveLabel}
          </button>
        )}
        {onReject && (
          <button onClick={onReject} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {rejectLabel}
          </button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {dismissLabel}
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--red)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {deleteLabel}
          </button>
        )}
        {onClear && (
          <button onClick={onClear} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
