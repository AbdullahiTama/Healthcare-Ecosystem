import { useId, useState } from 'react'
import { searchBanks } from '@care-ecosystem/shared-payout-ui'
import { theme } from '../../styles/theme.js'

// Searchable bank combobox (WAI-ARIA combobox + listbox pattern). The bank list
// comes from Paystack via /api/banks: popular banks first, then A-Z.
// `status`: 'loading' | 'ready' | 'error'.
export default function BankPicker({ banks, status, selectedCode, onSelect, onRetry, error }) {
  const listId = useId()
  const inputId = useId()
  const selected = banks.find((b) => b.code === selectedCode) || null
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const shown = searchBanks(banks, selected && text === selected.name ? '' : text)

  function choose(bank) {
    onSelect(bank)
    setText(bank.name)
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); choose(shown[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={inputId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>
        Bank<span style={{ color: theme.danger }} aria-hidden="true"> *</span>
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].code}` : undefined}
        aria-invalid={!!error}
        autoComplete="off"
        value={text}
        placeholder={status === 'loading' ? 'Loading banks…' : 'Search your bank (e.g. Zenith, OPay, Moniepoint)'}
        disabled={status === 'loading'}
        onChange={(e) => {
          setText(e.target.value); setOpen(true); setActive(0)
          if (selected && e.target.value !== selected.name) onSelect(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${error ? theme.danger : theme.gray200}`, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'white', fontFamily: theme.fontFamily }}
      />
      {status === 'error' && (
        <p role="alert" style={{ margin: '6px 0 0', fontSize: 12, color: theme.danger }}>
          Could not load banks.{' '}
          <button type="button" onClick={onRetry} style={{ background: 'none', border: 'none', padding: 0, color: theme.tealDeep, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>Retry</button>
        </p>
      )}
      {open && status === 'ready' && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Banks"
          style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, margin: '4px 0 0', padding: 4, listStyle: 'none', maxHeight: 260, overflowY: 'auto', background: '#fff', border: `1px solid ${theme.gray200}`, borderRadius: theme.radius.md, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
        >
          {shown.length === 0 && (
            <li role="option" aria-disabled="true" aria-selected="false" style={{ padding: '10px 12px', fontSize: 12.5, color: theme.textLight }}>
              No bank matches “{text}”
            </li>
          )}
          {shown.map((b, i) => (
            <li
              key={b.code}
              id={`${listId}-${b.code}`}
              role="option"
              aria-selected={b.code === selectedCode}
              onMouseDown={(e) => { e.preventDefault(); choose(b) }}
              onMouseEnter={() => setActive(i)}
              style={{ minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: i === active ? theme.tealMist : 'transparent', color: theme.navy }}
            >
              <span>{b.name}</span>
              {b.popular && !text && <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep }}>POPULAR</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
