import { theme } from '../../theme'

// BarList — horizontal ranked bars: "revenue by category", "most searched",
// "expenses this month". Replaces the % -width div bars hand-rolled in
// CareHub Reports (3 charts), CareHub AdminDashboard's 30-day trend, and the
// ranked lists CareFind renders as bare text.
//
// The bar is decoration (`aria-hidden`); every value is carried by real text,
// so the list reads correctly in a screen reader and in monochrome.
const TONES = {
  brand: theme.tealDeep,
  success: theme.success,
  warning: theme.warning,
  danger: theme.danger,
  info: theme.info,
  navy: theme.navy,
}

function colorFor(tone) {
  return TONES[tone] || TONES.brand
}

export function BarList({
  items = [],
  label,
  tone = 'brand',
  format = (v) => String(v),
  max,
  className,
  style = {},
}) {
  if (!items.length) return null

  const highest = max ?? Math.max(...items.map((item) => (Number.isFinite(Number(item.value)) ? Number(item.value) : 0)), 0)
  const scale = highest > 0 ? highest : 1

  return (
    <ul
      className={className}
      role="list"
      aria-label={label}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: theme.space[6], ...style }}
    >
      {items.map((item, i) => {
        const value = Number(item.value)
        const safe = Number.isFinite(value) ? value : 0
        const pct = Math.max(0, Math.min(100, (safe / scale) * 100))
        const color = colorFor(item.tone || tone)
        return (
          <li key={item.id ?? item.label ?? i}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[6], marginBottom: 6 }}>
              <span style={{ fontSize: theme.type.bodySm.size, fontWeight: 600, color: theme.textDark, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.label}
              </span>
              <span style={{ fontSize: theme.type.bodySm.size, fontWeight: 800, color: item.tone ? color : theme.textMid, flexShrink: 0 }}>
                {format(safe)}
              </span>
            </div>
            <div aria-hidden="true" style={{ height: 6, borderRadius: theme.radius.full, background: theme.gray200, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: theme.radius.full,
                  background: color,
                  transition: `width ${theme.motion.base} ${theme.motion.easeOut}`,
                }}
              />
            </div>
            {item.hint && (
              <div style={{ fontSize: theme.type.micro.size, fontWeight: 600, color: theme.textLight, marginTop: 4 }}>
                {item.hint}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default BarList
