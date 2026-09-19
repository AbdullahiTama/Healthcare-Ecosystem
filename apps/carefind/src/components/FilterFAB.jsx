import { SlidersHorizontal } from 'lucide-react'
import { theme } from '../styles/theme'

export default function FilterFAB({ onClick, activeCount = 0 }) {
  return (
    <button
      onClick={onClick}
      aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : 'Open filters'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        padding: '0 14px',
        borderRadius: 999,
        border: `1px solid ${activeCount > 0 ? theme.tealDeep : theme.border}`,
        background: activeCount > 0 ? theme.tealMist : '#fff',
        color: activeCount > 0 ? theme.tealDeep : theme.textMid,
        fontWeight: 700,
        fontSize: 12,
        cursor: 'pointer',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <SlidersHorizontal size={14} aria-hidden="true" />
      Filters
      {activeCount > 0 && (
        <span style={{
          minWidth: 18,
          height: 18,
          borderRadius: 999,
          background: theme.tealDeep,
          color: '#fff',
          fontSize: 10,
          fontWeight: 800,
          display: 'grid',
          placeItems: 'center',
          padding: '0 4px',
        }}>{activeCount}</span>
      )}
    </button>
  )
}
