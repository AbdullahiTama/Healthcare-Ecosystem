import { theme } from '../styles/theme'

const { navy, gray500, gray600, border, tealDeep, tealMist } = theme
const plain = { padding: '7px 12px', minHeight: 36, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }

// The bar above a list that supports marking rows for a bulk action (Inventory, Clients, Debts, Expenses, Purchases):
// how many are selected, "Select all N shown" (the current search and filters, every page), Clear, and the page's own
// actions (children).
//
// The actions are always on show, disabled until something is selected, with a one-line hint: a pharmacy asked for
// "Select all" and "Delete selected" in Stock Management although both existed, because the actions appeared only
// after a row had been ticked. While rows are selected the bar stays at the top of the screen as the list scrolls, so
// on a phone the actions are in reach from any row.
export default function SelectionBar({ count, shownCount, allShownSelected, onSelectAll, onClear, children }) {
  const active = count > 0
  return (
    <div role='toolbar' aria-label='Bulk actions'
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '10px 12px', borderRadius: theme.radius.md, background: active ? tealMist : 'transparent', border: active ? 'none' : `1px dashed ${border}`, ...(active ? { position: 'sticky', top: 0, zIndex: 5 } : {}) }}>
      {active
        ? <span aria-live='polite' style={{ fontWeight: 800, fontSize: 13, color: tealDeep }}>{count} selected</span>
        : <span aria-live='polite' style={{ fontSize: 12, color: gray500 }}>Tick the boxes to select, or select all.</span>}
      {!allShownSelected && shownCount > 0 && (
        <button type='button' onClick={onSelectAll} style={{ ...plain, color: navy }}>Select all {shownCount} shown</button>
      )}
      {active && <button type='button' onClick={onClear} style={{ ...plain, color: gray600 }}>Clear</button>}
      {children && (
        // A disabled fieldset disables every button the page put in it, so no action runs on an empty selection.
        <fieldset disabled={!active} title={active ? undefined : 'Select at least one first'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: 'none', margin: 0, padding: 0, minWidth: 0, opacity: active ? 1 : 0.5 }}>
          {children}
        </fieldset>
      )}
    </div>
  )
}
