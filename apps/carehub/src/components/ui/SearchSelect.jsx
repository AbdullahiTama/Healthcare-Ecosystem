import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { theme } from '../../styles/theme'

// A filter choice you can search: type part of a product, customer or staff
// name instead of scrolling a long list. Same props as Sel ({ label, value,
// onChange, options, placeholder }), where `placeholder` names the "no filter"
// choice ("All products"). WAI-ARIA combobox + listbox pattern:
//   * click or focus opens the list; typing narrows it (every word must match)
//   * ↑ ↓ move, Enter picks, Escape closes, Tab leaves
//   * the "All …" choice clears the filter; so does the × button
// Only the first SHOWN matches are drawn, so a catalogue of thousands of
// products stays instant; the list says how many more to narrow down.
export const SHOWN = 50

const norm = (v) => String(v ?? '').toLowerCase()
const toOption = (o) => (typeof o === 'string' ? { value: o, label: o } : o)

export function filterOptions(options, text) {
  const words = norm(text).split(/\s+/).filter(Boolean)
  const all = (options || []).map(toOption)
  return words.length ? all.filter((o) => { const l = norm(o.label); return words.every((w) => l.includes(w)) }) : all
}

export default function SearchSelect({ label, value, onChange, options = [], placeholder = 'All', id }) {
  const autoId = useId()
  const inputId = id || autoId
  const listId = inputId + '-list'
  const wrap = useRef(null)
  const input = useRef(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)

  const all = useMemo(() => (options || []).map(toOption), [options])
  const selected = all.find((o) => o.value === value) || null
  const matches = useMemo(() => filterOptions(all, text), [all, text])
  // Row 0 is "All …" (clears the filter) unless the user is typing.
  const rows = useMemo(() => (text ? matches.slice(0, SHOWN) : [{ value: '', label: placeholder }, ...matches.slice(0, SHOWN)]), [text, matches, placeholder])
  const hidden = matches.length - Math.min(matches.length, SHOWN)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setText('') } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function pick(option) {
    onChange(option.value)
    setText('')
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); setActive((i) => Math.min(i + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { if (open && rows[active]) { e.preventDefault(); pick(rows[active]) } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false); setText('') } }
    else if (e.key === 'Tab') { setOpen(false); setText('') }
  }

  const shownLabel = open ? text : (selected ? selected.label : '')
  return (
    <div ref={wrap} style={{ position: 'relative', minWidth: 0 }}>
      <label htmlFor={inputId} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <Search size={14} aria-hidden='true' color={theme.gray400} style={{ position: 'absolute', left: 11, top: 15, pointerEvents: 'none' }} />
        <input
          ref={input}
          id={inputId}
          role='combobox'
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete='list'
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          autoComplete='off'
          value={shownLabel}
          placeholder={open ? 'Type to search…' : placeholder}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => { setOpen(true); setActive(0) }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={{
            width: '100%', minHeight: 44, padding: '9px 60px 9px 32px', borderRadius: theme.radius.md, boxSizing: 'border-box',
            border: `1px solid ${open ? theme.tealDeep : theme.gray200}`, fontSize: 13, outline: 'none', background: 'white',
            color: selected || open ? theme.navy : theme.textLight, fontFamily: theme.fontFamily, textOverflow: 'ellipsis',
          }}
        />
        {selected && !open && (
          <button type='button' aria-label={`Clear ${label} filter`} onClick={() => { onChange(''); input.current?.focus() }}
            style={{ position: 'absolute', right: 30, top: 8, padding: 6, border: 'none', background: 'none', cursor: 'pointer', color: theme.gray400, display: 'flex' }}>
            <X size={14} />
          </button>
        )}
        <ChevronDown size={15} aria-hidden='true' color={theme.gray400} style={{ position: 'absolute', right: 11, top: 15, pointerEvents: 'none' }} />
      </div>
      {open && (
        <ul id={listId} role='listbox' aria-label={label}
          style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, margin: '4px 0 0', padding: 4, listStyle: 'none', maxHeight: 280, overflowY: 'auto', background: 'white', border: `1px solid ${theme.gray200}`, borderRadius: theme.radius.md, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {rows.length === 0 && (
            <li role='option' aria-disabled='true' aria-selected='false' style={{ padding: '10px 12px', fontSize: 12.5, color: theme.gray400 }}>
              Nothing matches “{text}”
            </li>
          )}
          {rows.map((o, i) => (
            <li key={o.value === '' ? '__all' : o.value} id={`${listId}-${i}`} role='option' aria-selected={o.value === (value || '')}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}
              onMouseEnter={() => setActive(i)}
              style={{
                minHeight: 38, display: 'flex', alignItems: 'center', padding: '7px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                background: i === active ? theme.tealMist : 'transparent', color: o.value === '' ? theme.gray500 : theme.navy,
                fontWeight: o.value === (value || '') ? 800 : 500, overflowWrap: 'anywhere',
              }}>
              {o.label}
            </li>
          ))}
          {hidden > 0 && (
            <li role='presentation' style={{ padding: '8px 12px', fontSize: 11.5, color: theme.gray400 }}>
              {hidden} more — keep typing to narrow the list
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
