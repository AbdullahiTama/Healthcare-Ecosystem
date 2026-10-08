import { theme } from '../../theme'

// MetricGrid — the responsive row of KPI tiles.
//
// One CSS rule does the responsive work (no JS breakpoints, so it is correct at
// 375px as well as 1920px and never scrolls horizontally):
//   - `columns`   → percentage minimum, so a 4-up grid becomes 3-up then 2-up
//                   as the container narrows, and never overflows.
//   - `minColumn` → pixel minimum (theme.dashboard.metricMin), for fluid rows.
// The tiles themselves are the app's choice — StatCard is the default.
export function MetricGrid({
  children,
  columns,
  minColumn,
  gap,
  label,
  className,
  style = {},
}) {
  const min = columns
    ? `${100 / columns}%`
    : `min(${minColumn ?? theme.dashboard.metricMin}px, 100%)`

  return (
    <div
      className={className}
      role={label ? 'group' : undefined}
      aria-label={label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))`,
        gap: gap ?? theme.space[8],
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export default MetricGrid
