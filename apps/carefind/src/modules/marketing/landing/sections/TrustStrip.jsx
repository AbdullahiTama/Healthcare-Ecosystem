import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { resolveIcon } from '../components/icons.js'
import { TRUST_STRIP } from '../data/landingContent.js'

// The capability/trust strip that closes the hero.
//
// Three mechanisms, stated without a single number: no user counts, no ratings
// of CareFind itself, nothing a visitor cannot go and check on a real listing.
// Stacked on phones, three across from tablet up. Like FeatureStrip these are
// list items, not headings, so the page outline stays h1 → section h2s.

export default function TrustStrip() {
  const { isMobile } = useBreakpoint()

  return (
    <ul
      data-hero-group
      style={{
        listStyle: 'none',
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
        gap: isMobile ? 16 : 24,
        margin: 0,
        padding: '24px 0 0',
        borderTop: '1px solid rgba(255,255,255,0.14)',
      }}
    >
      {TRUST_STRIP.map(({ icon, title, body }) => {
        const Icon = resolveIcon(icon)
        return (
          <li key={title} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 34,
                height: 34,
                borderRadius: theme.radius.full,
                background: 'rgba(255,255,255,0.14)',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              <Icon size={16} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.01em', color: '#fff' }}>
                {title}
              </span>
              <span style={{ display: 'block', fontSize: 12, lineHeight: 1.4, color: 'rgba(255,255,255,0.72)' }}>
                {body}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
