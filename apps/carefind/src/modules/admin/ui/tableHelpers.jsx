import { theme } from '../../../styles/theme'

// The shared DataTable opens rows on mouse click only. Rendering the primary
// cell as a real button makes "open this record" reachable by keyboard and
// by screen readers without changing the shared component.
export function primaryCell({ title, sub, onOpen, openLabel }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen() }}
      aria-label={openLabel}
      style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: theme.fontFamily }}
    >
      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: theme.textDark }}>{title}</span>
      {sub && <span style={{ display: 'block', fontSize: 11.5, color: theme.textLight, marginTop: 2 }}>{sub}</span>}
    </button>
  )
}

const box = { width: 16, height: 16, cursor: 'pointer', accentColor: theme.tealDeep }

export function selectionColumn({ rows, selectedIds, onToggle, onToggleAll, rowLabel }) {
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
  return {
    key: '__select',
    label: (
      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={onToggleAll} onClick={(e) => e.stopPropagation()} style={box} />
    ),
    render: (row) => (
      <input
        type="checkbox"
        aria-label={`Select ${rowLabel(row)}`}
        checked={selectedIds.has(row.id)}
        onChange={() => onToggle(row.id)}
        onClick={(e) => e.stopPropagation()}
        style={box}
      />
    ),
  }
}
