import { theme } from '../../../styles/theme'

export function FilterPills({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(opt => {
        const key = typeof opt === 'string' ? opt : opt.value
        const label = typeof opt === 'string' ? opt : opt.label
        const active = value === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{
              padding: '6px 14px',
              borderRadius: theme.radius.full,
              fontSize: 12,
              fontWeight: 700,
              border: active ? `1px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
              background: active ? theme.tealMist : 'white',
              color: active ? theme.tealDeep : theme.gray600,
              cursor: 'pointer',
              fontFamily: theme.fontFamily,
              transition: `all ${theme.motion.fast}`,
              textTransform: 'capitalize',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function DateRange({ from, to, onFrom, onTo }) {
  const inputStyle = {
    flex: 1,
    minHeight: 40,
    padding: '8px 12px',
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.gray200}`,
    background: 'white',
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: theme.fontFamily,
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: theme.gray600, display: 'block', marginBottom: 4 }}>From</label>
        <input type="date" value={from || ''} onChange={(e) => onFrom(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: theme.gray600, display: 'block', marginBottom: 4 }}>To</label>
        <input type="date" value={to || ''} onChange={(e) => onTo(e.target.value)} style={inputStyle} />
      </div>
    </div>
  )
}
