import { theme } from '../../theme'
import { SectionCard } from './SectionCard'
import { Skeleton, Empty, ErrorState } from '../ui/State'

// ChartCard — a SectionCard that owns the three states a chart must never ship
// without (docs/design/README.md non-negotiable #1): loading, error, empty.
//
// `error` accepts `true` (generic) or a message string; `onRetry` is what makes
// it a state rather than a dead end. The plot area keeps a floor height so a
// chart never collapses into a squashed line while data is in flight.
//
// The chart itself is supplied by the app — this package ships Sparkline and
// BarList, and no charting dependency is added (see DASHBOARD_FOUNDATION.md).
export function ChartCard({
  title,
  sub,
  actions,
  legend,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyMessage = 'No data for this period yet.',
  minHeight,
  headingLevel,
  className,
  style,
  children,
}) {
  const floor = minHeight ?? theme.dashboard.chartMinHeight

  let body
  if (loading) {
    body = (
      <div role="status" aria-live="polite" aria-busy="true" style={{ minHeight: floor, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: theme.space[6] }}>
        <Skeleton width="100%" height={floor - 40} radius={theme.radius.md} />
        <div style={{ display: 'flex', gap: theme.space[6] }}>
          <Skeleton width="30%" height={10} />
          <Skeleton width="30%" height={10} />
          <Skeleton width="30%" height={10} />
        </div>
      </div>
    )
  } else if (error) {
    body = <ErrorState message={typeof error === 'string' ? error : undefined} onRetry={onRetry} />
  } else if (empty) {
    body = <Empty message={emptyMessage} cause="none" />
  } else {
    body = <div style={{ minHeight: floor }}>{children}</div>
  }

  return (
    <SectionCard title={title} sub={sub} actions={actions} headingLevel={headingLevel} className={className} style={style}>
      {legend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space[8], marginBottom: theme.space[8] }}>
          {legend}
        </div>
      )}
      {body}
    </SectionCard>
  )
}

export default ChartCard
