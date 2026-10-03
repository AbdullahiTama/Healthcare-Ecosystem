import { theme } from '../../theme'

// FilterBar — the toolbar row above a table or list: a SearchBar, then filter
// controls, then (right-aligned, wrapping onto their own line on mobile) any
// bulk actions or result count.
//
//   <FilterBar right={<Button/>}>
//     <SearchBar value={q} onChange={setQ} />
//     <Select ... />
//     <Pill ... />
//   </FilterBar>
//
// It deliberately owns no controls itself — the controls differ per screen,
// and both apps already have Select/Pill/FilterPills to put here.
export function FilterBar({ children, right, label = 'Filters', className, style = {} }) {
  return (
    <div
      className={className}
      role="group"
      aria-label={label}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.space[6],
        ...style,
      }}
    >
      {children}
      {right && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: theme.space[6], flexWrap: 'wrap' }}>
          {right}
        </div>
      )}
    </div>
  )
}

export default FilterBar
