import { useMemo, useState, useRef } from 'react'
import { Truck, AlertTriangle, UserPlus } from 'lucide-react'
import { fmt, fmtDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { matchSupplier } from './suppliers'

const { navy, gray50, gray100, gray400, gray500, gray600, border, danger, warning, warningBg, tealDeep, tealMist, success } = theme

// The supplier on a purchase: type to search the suppliers already bought from
// and pick one (so one supplier's spending and debts stay together), with a
// warning when what is typed looks like an existing supplier spelt differently.
// Once a known supplier is chosen its totals show underneath.
//
// An ARIA 1.2 combobox: arrows move through the list, Enter picks, Escape
// closes; picking with the mouse does not blur the field first.
export default function SupplierField({ id, value, onChange, suppliers = [], status = 'ready', error, label = 'Supplier' }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef(null)
  const { exact, similar, matches } = useMemo(() => matchSupplier(suppliers, value), [suppliers, value])
  const listId = id + '-list'
  const showList = open && matches.length > 0 && !(exact && matches.length === 1)

  function pick(s) {
    onChange(s.name)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && showList && active >= 0 && matches[active]) { e.preventDefault(); pick(matches[active]) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
  }

  // Leaving the field with a known supplier typed in another case keeps the
  // supplier's own spelling.
  function onBlur() {
    setOpen(false)
    if (exact && exact.name !== String(value || '').trim()) onChange(exact.name)
  }

  const described = [error ? id + '-error' : null, id + '-status'].filter(Boolean).join(' ')
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>
        {label} <span aria-hidden='true' style={{ color: danger }}>*</span>
      </label>
      <input ref={inputRef} id={id} value={value || ''} autoComplete='off' required
        role='combobox' aria-autocomplete='list' aria-expanded={showList} aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? listId + '-' + active : undefined}
        aria-invalid={!!error} aria-describedby={described}
        placeholder={status === 'loading' ? 'Loading your suppliers…' : 'Search or type a supplier, e.g. MedSupply Ltd'}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)} onBlur={onBlur} onKeyDown={onKeyDown}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${error ? danger : border}`, fontSize: 14, outline: 'none', color: navy, background: 'white', fontFamily: theme.fontFamily }} />
      {error && <div id={id + '-error'} style={{ fontSize: 12, color: danger, marginTop: 4 }}>{error}</div>}

      <ul id={listId} role='listbox' aria-label='Existing suppliers' hidden={!showList}
        style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, padding: 4, listStyle: 'none', background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', maxHeight: 260, overflowY: 'auto' }}>
        {matches.map((s, i) => (
          <li key={s.key} id={listId + '-' + i} role='option' aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)} onMouseEnter={() => setActive(i)}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 10px', borderRadius: theme.radius.sm, cursor: 'pointer', background: i === active ? tealMist : 'transparent' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: navy, overflowWrap: 'anywhere' }}>{s.name}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: gray500 }}>{s.purchaseCount} purchase{s.purchaseCount === 1 ? '' : 's'}{s.lastDate ? ' · last ' + fmtDate(s.lastDate) : ''}</span>
            </span>
            {s.balance > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: danger, whiteSpace: 'nowrap', alignSelf: 'center' }}>{fmt(s.balance)} owed</span>}
          </li>
        ))}
      </ul>

      <div id={id + '-status'} aria-live='polite' style={{ marginTop: 8 }}>
        {exact ? (
          <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: gray50, border: `1px solid ${gray100}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: tealDeep }}>
              <Truck size={13} aria-hidden='true' /> Existing supplier
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 6, fontSize: 12, color: gray600 }}>
              <Fact label='Purchases' value={exact.purchaseCount} />
              <Fact label='Total spent' value={fmt(exact.totalSpent)} />
              <Fact label='Paid' value={fmt(exact.paid)} color={success} />
              <Fact label='Outstanding' value={fmt(exact.balance)} color={exact.balance > 0 ? danger : success} />
              {exact.lastDate && <Fact label='Last purchase' value={fmtDate(exact.lastDate) + (exact.lastTotal != null ? ' · ' + fmt(exact.lastTotal) : '')} />}
            </div>
          </div>
        ) : similar.length > 0 ? (
          <div role='alert' style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: 12.5, color: theme.amberText || navy }}>
            <AlertTriangle size={14} color={warning} aria-hidden='true' style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ flex: '1 1 180px' }}>This looks like a supplier you already have. Pick it so its purchases and debts stay together:</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {similar.map((s) => (
                <button key={s.key} type='button' onClick={() => { onChange(s.name); inputRef.current?.focus() }}
                  style={{ padding: '5px 10px', minHeight: 32, borderRadius: theme.radius.sm, border: `1px solid ${warning}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  Use {s.name}
                </button>
              ))}
            </span>
          </div>
        ) : String(value || '').trim() && status === 'ready' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray500 }}>
            <UserPlus size={13} aria-hidden='true' /> New supplier: added when you save.
          </div>
        ) : status === 'error' ? (
          <div style={{ fontSize: 12, color: gray400 }}>Your supplier list could not be loaded; you can still type the name.</div>
        ) : null}
      </div>
    </div>
  )
}

function Fact({ label, value, color = navy }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}
