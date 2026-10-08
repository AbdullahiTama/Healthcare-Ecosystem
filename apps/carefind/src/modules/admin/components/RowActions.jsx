import { Eye, CheckCircle, Trash2 } from 'lucide-react'

export function RowActions({ actions }) {
  if (!actions || actions.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', gap: 4, opacity: 0.9 }} className="row-hover-actions">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); a.onClick?.() }}
          disabled={a.disabled}
          title={a.label}
          style={{
            padding: '4px 8px',
            borderRadius: 6,
            border: a.variant === 'primary' ? 'none' : a.variant === 'danger' ? 'none' : '1px solid var(--border)',
            background: a.variant === 'primary' ? 'var(--green)' : a.variant === 'danger' ? 'var(--red)' : 'var(--panel)',
            color: a.variant === 'primary' || a.variant === 'danger' ? 'white' : 'var(--muted)',
            fontWeight: 700,
            fontSize: 11,
            cursor: a.disabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {a.icon}
          {a.label && <span>{a.label}</span>}
        </button>
      ))}
    </span>
  )
}
