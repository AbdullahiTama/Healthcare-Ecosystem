import { useId, useState } from 'react'
import { SlidersHorizontal, ChevronDown, X } from 'lucide-react'
import { theme } from '../styles/theme'

// The filter controls shared by Debts, Clients and Expenses. The rules they drive live in lib/recordFilters.js and
// each page's own filter module; these components only present them.
//
//   FilterPanel        collapsible group with an active-filter count and "Clear all filters"
//   FilterSelect       a labelled choice with an "All" option
//   AmountRangeFilter  a labelled minimum / maximum pair
//
// Dates use components/PeriodFilter (day, week, month, year, custom range), placed inside the panel by the page.

const { navy, gray500, gray600, border, tealDeep, tealMist } = theme

const control = {
  width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`,
  fontSize: 13, outline: 'none', color: navy, background: 'white', fontFamily: theme.fontFamily, boxSizing: 'border-box',
}
const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }

export function FilterPanel({ title = 'Filters', activeCount = 0, onClear, defaultOpen = false, children }) {
  const uid = useId()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', flexWrap: 'wrap' }}>
        <button type='button' onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={uid + '-body'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', minHeight: 40, border: 'none', background: 'none', cursor: 'pointer', color: navy, fontWeight: 800, fontSize: 13 }}>
          <SlidersHorizontal size={15} aria-hidden='true' />
          {title}
          {activeCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 800, color: tealDeep, background: tealMist, borderRadius: theme.radius.full, padding: '2px 8px' }}>
              {activeCount} active
            </span>
          )}
          <ChevronDown size={15} aria-hidden='true' style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        {activeCount > 0 && onClear && (
          <button type='button' onClick={onClear}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', minHeight: 36, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            <X size={13} aria-hidden='true' /> Clear all filters
          </button>
        )}
      </div>
      {open && (
        <div id={uid + '-body'} role='group' aria-label={title}
          style={{ padding: '4px 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 14, alignItems: 'start' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// `options`: [value, label] pairs. The empty value is "All" (no filter).
export function FilterSelect({ label, value, onChange, options, allLabel = 'All' }) {
  const id = useId()
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)} style={control}>
        <option value=''>{allLabel}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

// `value`: { min, max } as typed (strings). Blank means no bound. `minPlaceholder` suits counts ("0") as well as naira.
export function AmountRangeFilter({ label, value, onChange, children, minPlaceholder = '₦0' }) {
  const id = useId()
  const v = value || { min: '', max: '' }
  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ ...labelStyle, padding: 0 }}>{label}</legend>
      {children}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label htmlFor={id + '-min'} style={{ fontSize: 12, color: gray500 }}>Min</label>
        <input id={id + '-min'} type='number' inputMode='decimal' min='0' value={v.min} placeholder={minPlaceholder}
          onChange={(e) => onChange({ ...v, min: e.target.value })} style={{ ...control, minWidth: 0 }} />
        <label htmlFor={id + '-max'} style={{ fontSize: 12, color: gray500 }}>Max</label>
        <input id={id + '-max'} type='number' inputMode='decimal' min='0' value={v.max} placeholder='Any'
          onChange={(e) => onChange({ ...v, max: e.target.value })} style={{ ...control, minWidth: 0 }} />
      </div>
    </fieldset>
  )
}
