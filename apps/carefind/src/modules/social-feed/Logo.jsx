import { theme } from '../../styles/theme'

// The CareFind logo: location pin with person silhouette — the brand mark
// communicates "find the right care" at a glance. Flat teal, no gradient.
//
//   <Logo />                       full logo, default size
//   <Logo size={40} />             bigger
//   <Logo markOnly />              just the icon (app icon, avatars, watermarks)
//   <Logo tone="light" />          wordmark in white (for dark backgrounds)
//   <Logo tone="dark" />           wordmark in navy (for light backgrounds)
//   <Logo tone="muted" />          wordmark in grey (subtle, like a byline)
function Logo({ size = 32, markOnly = false, tone = 'light', style = {} }) {
  const wordColor =
    tone === 'muted' ? 'rgba(255,255,255,0.55)'
    : tone === 'dark' ? theme.navy
    : '#fff'

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="CareFind"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M32 4C20.954 4 12 12.954 12 24c0 14.25 20 36 20 36s20-21.75 20-36C52 12.954 43.046 4 32 4z"
        fill={theme.tealDeep}
      />
      <circle cx="32" cy="22" r="7" fill="white" />
      <path
        d="M20 38c0-6.627 5.373-12 12-12s12 5.373 12 12"
        stroke="white"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
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
