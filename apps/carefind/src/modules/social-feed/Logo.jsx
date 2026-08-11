import { Activity } from 'lucide-react'
import { theme } from '../../styles/theme'

// The CareFind logo: a flat teal rounded tile carrying the shared ecosystem
// pulse mark, next to the wordmark. One component so the logo is identical
// everywhere it appears.
//
// The mark matches CareHub's (`Activity` in a flat teal-600 rounded square —
// ICONS.md, "the brand mark is one component"): BRAND_GUIDELINES.md asks for
// the two products to be instantly distinguishable but unmistakably related,
// and a shared mark with a different wordmark is exactly that. Flat, not
// gradient, like every other surface in the system.
//
//   <Logo />                       full logo, default size
//   <Logo size={40} />             bigger
//   <Logo markOnly />              just the tile (app icon, avatars, watermarks)
//   <Logo tone="light" />          wordmark in white (for dark backgrounds)
//   <Logo tone="muted" />          wordmark in grey (subtle, like a byline)
function Logo({ size = 32, markOnly = false, tone = 'light', style = {} }) {
  const wordColor =
    tone === 'muted' ? 'rgba(255,255,255,0.55)'
    : tone === 'dark' ? theme.navy
    : '#fff'

  const mark = (
    <div
      role="img"
      aria-label="CareFind"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: theme.tealDeep,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        flexShrink: 0,
      }}
    >
      <Activity size={size * 0.58} strokeWidth={2.6} aria-hidden="true" />
    </div>
  )

  if (markOnly) return <div style={style}>{mark}</div>

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.35, textDecoration: 'none', ...style }}>
      {mark}
      <span
        style={{
          fontSize: size * 0.46,
          fontWeight: 800,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: wordColor,
          lineHeight: 1,
          textDecoration: 'none',
        }}
      >
        CareFind
      </span>
    </div>
  )
}

export default Logo
