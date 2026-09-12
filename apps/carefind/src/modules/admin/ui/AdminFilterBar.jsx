import { theme } from '../../../styles/theme'

export default function AdminFilterBar({ search, onSearch, searchPlaceholder = 'Search...', children }) {
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: theme.space[5], marginBottom: theme.space[8] }}>
      {onSearch && (
        <input
          type="text"
          value={search || ''}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          style={{
            width: '100%',
            minHeight: 44,
            padding: '9px 12px',
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.gray200}`,
            background: 'white',
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
            fontFamily: theme.fontFamily,
            marginBottom: children ? theme.space[4] : 0,
          }}
        />
      )}
      {children}
    </div>
  )
}
