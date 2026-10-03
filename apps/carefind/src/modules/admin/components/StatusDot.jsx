export function StatusDot({ status }) {
  const map = {
    pending: 'var(--amber)',
    active: 'var(--green)',
    verified: 'var(--green)',
    approved: 'var(--green)',
    completed: 'var(--green)',
    suspended: 'var(--red)',
    rejected: 'var(--red)',
    revoked: 'var(--red)',
    deleted: 'var(--red)',
    flagged: 'var(--amber)',
    dismissed: 'var(--gray)',
    resolved: 'var(--green)',
    processing: 'var(--amber)',
    paid: 'var(--green)',
    refunded: 'var(--red)',
    open: 'var(--amber)',
    resolved_error: 'var(--gray)',
  }
  const c = map[status] || 'var(--gray)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: c, display: 'inline-block', flexShrink: 0 }} />
      <span className="sr-only">{status}</span>
    </span>
  )
}
