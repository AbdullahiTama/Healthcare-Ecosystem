import { Search, X } from 'lucide-react'
import { theme } from '../../theme'

// SearchBar — the one dashboard search field.
//
// The identical "icon + white input + radius + focus ring" wrapper is
// hand-rolled at least 11 times in CareHub (Appointments, Demand, Clients,
// Consultation, Debts ×2, Purchases, Inventory, StockValidation, Stock, POS)
// and once more inside CareFind's AdminFilterBar.
//
// `onChange` receives the value (not the event) — the same contract as the
// shared Input/Select. Focus styling mirrors PageHeader's so a search field
// looks the same wherever it appears.
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export function SearchBar({
  label = 'Search',
  value = '',
  onChange,
  placeholder = 'Search…',
  id,
  autoFocus,
  className,
  style = {},
}) {
  const inputId = id || `ds-search-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div role="search" className={className} style={{ position: 'relative', flex: '1 1 200px', minWidth: 0, maxWidth: 380, ...style }}>
      <label htmlFor={inputId} style={VISUALLY_HIDDEN}>{label}</label>
      <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: theme.gray400, pointerEvents: 'none' }} />
      <input
        id={inputId}
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{
          width: '100%',
          minHeight: 40,
          padding: value ? `8px 36px 8px 36px` : `8px 12px 8px 36px`,
          borderRadius: theme.radius.md,
          border: `1px solid ${theme.gray200}`,
          background: 'white',
          color: theme.textDark,
          fontSize: theme.type.body.size,
          fontFamily: theme.fontFamily,
          boxSizing: 'border-box',
          outline: 'none',
          WebkitAppearance: 'none',
          WebkitSearchCancelButton: 'none',
          transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = theme.tealDeep; e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.tealMist}` }}
        onBlur={(e) => { e.currentTarget.style.borderColor = theme.gray200; e.currentTarget.style.boxShadow = 'none' }}
      />
      {value ? (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange && onChange('')}
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.full,
            border: 'none',
            background: 'transparent',
            color: theme.gray500,
            cursor: 'pointer',
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export default SearchBar
