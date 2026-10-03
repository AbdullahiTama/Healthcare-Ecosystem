import { theme } from '../../theme'

// Sparkline — the one trend line for the whole ecosystem.
//
// Three byte-near-identical copies of this existed (CareHub AdminDashboard,
// CareHub money/RevenueOverview, CareFind admin DashboardTab — the last one
// never even rendered). Hand-rolled SVG on purpose: no charting dependency is
// justified for a trend line, and the alternative is a 4th copy.
//
// Accessibility: always an `role="img"` with a generated summary ("12 points,
// ₦1.2m → ₦1.9m, up") so the shape is never the only way to read the trend.
// `vectorEffect: non-scaling-stroke` + `preserveAspectRatio: none` keep the
// stroke a true 2px while the line stretches to any container width.
// No draw-in animation: MOTION.md prefers restraint, and a static line also
// satisfies prefers-reduced-motion with no work.
function formatValue(v, format) {
  try {
    return format ? format(v) : String(v)
  } catch {
    return String(v)
  }
}

export function Sparkline({
  data = [],
  height = 48,
  width = '100%',
  stroke,
  fill = true,
  fillColor,
  label,
  format,
  className,
  style = {},
}) {
  const points = data.filter((v) => typeof v === 'number' && Number.isFinite(v))

  if (points.length === 0) return null

  // A single sample is still a real trend line — a flat one.
  const series = points.length === 1 ? [points[0], points[0]] : points
  const n = series.length

  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1

  const W = 100
  const H = Math.max(8, height)
  const pad = 2

  const coords = series.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * W
    const y = H - pad - ((v - min) / span) * (H - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const first = series[0]
  const last = series[n - 1]
  const direction = last > first ? 'up' : last < first ? 'down' : 'flat'
  const summary = label
    || `Trend of ${n} points, from ${formatValue(first, format)} to ${formatValue(last, format)}, ${direction}`

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      width={width}
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary}
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      {fill && (
        <polygon
          points={`0,${H} ${coords.join(' ')} ${W},${H}`}
          fill={fillColor || theme.tealMist}
          stroke="none"
        />
      )}
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke || theme.tealDeep}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default Sparkline
