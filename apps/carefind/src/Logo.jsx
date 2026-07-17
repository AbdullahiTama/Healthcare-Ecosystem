import { theme } from './lib/theme'

// The CareFind logo: a teal rounded tile with a white "C", next to the wordmark.
// One component so the logo is identical everywhere it appears.
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
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: theme.tealGradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 900,
        fontSize: size * 0.55,
        lineHeight: 1,
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(13,148,136,0.35)',
      }}
    >
      C
    </div>
  )

  if (markOnly) return <div style={style}>{mark}</div>

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.35, ...style }}>
      {mark}
      <span
        style={{
          fontSize: size * 0.46,
          fontWeight: 800,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: wordColor,
          lineHeight: 1,
        }}
      >
        CareFind
      </span>
    </div>
  )
}

export default Logo
