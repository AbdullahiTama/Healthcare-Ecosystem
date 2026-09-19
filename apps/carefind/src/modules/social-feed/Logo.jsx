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
      viewBox="0 0 100.96 114.74"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="CareFind"
      style={{ flexShrink: 0, color: theme.tealDeep }}
    >
      <title>CareFind</title>
      <path d="M50.42 0 C36.5 0 24.61 4.38 14.77 13.13 C4.92 21.86 -0 32.43 -0 44.81 C-0 55.92 3.51 66.84 10.52 77.58 C17.52 88.33 25.07 97.2 33.19 104.21 C41.31 111.22 47.06 114.74 50.42 114.74 C53.79 114.74 59.53 111.22 67.66 104.21 C75.75 97.2 83.35 88.33 90.4 77.58 C97.45 66.84 100.96 55.92 100.96 44.81 C100.96 32.43 96.01 21.86 86.15 13.13 C76.26 4.38 64.35 0 50.42 0" fill="currentColor" />
      <path d="M50.52 15.32 C68.71 15.32 83.46 30.56 83.46 49.35 C83.46 68.15 68.71 83.38 50.52 83.38 C32.33 83.38 17.58 68.15 17.58 49.35 C17.58 30.56 32.33 15.32 50.52 15.32" fill="white" fillRule="evenodd" />
      <path d="M50.85 28.3 C57.36 28.3 62.64 33.76 62.64 40.48 C62.64 47.21 57.36 52.66 50.85 52.66 C44.34 52.66 39.06 47.21 39.06 40.48 C39.06 33.76 44.34 28.3 50.85 28.3" fill="currentColor" fillRule="evenodd" />
      <path d="M29.41 73.38 C35.22 52.7 70.73 53.5 72.29 73.17 L51.35 81.37 Z" fill="currentColor" fillRule="evenodd" />
      <path d="M70.33 86.45 C77.64 79.46 62.1 107.14 81.62 104.69 C97.47 46.91 94.28 63.88 53.51 82.37 C55.19 90.79 62.32 94.1 70.33 86.45" fill="currentColor" stroke="white" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M63 106.27 C59.19 106.27 56.1 103.06 56.1 99.1 C56.1 95.13 59.19 91.92 63 91.92 C66.81 91.92 69.91 95.13 69.91 99.1 C69.91 103.06 66.81 106.27 63 106.27" fill="currentColor" stroke="white" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
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
