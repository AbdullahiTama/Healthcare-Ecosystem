import { Link } from 'react-router-dom'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import Logo from '../../../social-feed/Logo.jsx'
import { FOOTER } from '../data/landingContent.js'

// The footer.
//
// Every link here points at a route that exists in main.jsx. There are no
// support, privacy or terms pages in this app yet, so those entries render as
// muted text rather than links that would 404 — a marketing page that sends
// visitors to a NotFound screen is worse than one that admits the page does not
// exist yet.

export default function SiteFooter() {
  const { isMobile, isMobileOrTablet } = useBreakpoint()

  // Five columns only from laptop up. At tablet the brand block goes full
  // width and the four link columns pair up — squeezing five columns into
  // 728px leaves ~135px each, which wraps "For providers" mid-word.
  const columns = isMobile
    ? '1fr'
    : isMobileOrTablet
      ? 'repeat(2, minmax(0, 1fr))'
      : '1.4fr repeat(4, minmax(0, 1fr))'

  return (
    <footer
      style={{
        background: theme.cardBg,
        borderTop: `1px solid ${theme.border}`,
        padding: '44px 20px 32px',
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns,
            gap: isMobile ? 28 : 24,
          }}
        >
          <div style={{ minWidth: 0, gridColumn: isMobileOrTablet ? '1 / -1' : 'auto' }}>
            <Logo size={24} tone="dark" />
            <p
              style={{
                margin: '14px 0 0',
                fontSize: 13,
                lineHeight: 1.6,
                color: theme.textMid,
                maxWidth: 240,
              }}
            >
              {FOOTER.legal}
            </p>
          </div>

          {FOOTER.columns.map((column) => (
            <nav key={column.title} aria-label={column.title} style={{ minWidth: 0 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: theme.textDark,
                  marginBottom: 12,
                }}
              >
                {column.title}
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.disabled ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          // 44px touch floor (ACCESSIBILITY.md:32) — this was
                          // 36px, flagged by the real-browser a11y audit.
                          minHeight: 44,
                          fontSize: 13.5,
                          color: theme.gray400,
                        }}
                      >
                        {link.label}
                      </span>
                    ) : (
                      <Link
                        to={link.to}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          // 44x44 floor on both axes: a short label like
                          // "Sign in" renders 42px wide at minHeight 44 alone.
                          minWidth: 44,
                          minHeight: 44,
                          fontSize: 13.5,
                          color: theme.textMid,
                          textDecoration: 'none',
                          borderRadius: theme.radius.sm,
                          transition: `color ${theme.motion.fast} ${theme.motion.easeOut}`,
                        }}
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 36,
            paddingTop: 20,
            borderTop: `1px solid ${theme.hairline}`,
            fontSize: 12,
            color: theme.textLight,
          }}
        >
          <Logo size={16} tone="dark" markOnly />
          &copy; 2026 CareFind
        </div>
      </div>
    </footer>
  )
}
