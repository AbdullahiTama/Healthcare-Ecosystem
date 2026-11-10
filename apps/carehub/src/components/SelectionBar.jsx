import { theme } from '../styles/theme'

const { navy, gray600, border, tealDeep, tealMist } = theme
const plain = { padding: '7px 12px', minHeight: 36, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }

// The bar above a list that supports marking rows for a bulk action (Inventory, Clients): how many are selected,
// "Select all N shown" (the current search and filters), Clear, and the page's own actions (children), shown once
// something is selected.
export default function SelectionBar({ count, shownCount, allShownSelected, onSelectAll, onClear, children }) {
  return (
    <div role='toolbar' aria-label='Bulk actions' style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: count ? '10px 12px' : 0, borderRadius: theme.radius.md, background: count ? tealMist : 'transparent' }}>
      {count > 0 && <span aria-live='polite' style={{ fontWeight: 800, fontSize: 13, color: tealDeep }}>{count} selected</span>}
      {!allShownSelected && shownCount > 0 && (
        <button type='button' onClick={onSelectAll} style={{ ...plain, color: navy }}>Select all {shownCount} shown</button>
      )}
      {count > 0 && (
        <>
          <button type='button' onClick={onClear} style={{ ...plain, color: gray600 }}>Clear</button>
          {children}
        </>
      )}
    </div>
  )
}
