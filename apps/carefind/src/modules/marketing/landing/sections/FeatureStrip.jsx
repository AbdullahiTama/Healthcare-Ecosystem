import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { resolveIcon } from '../components/icons.js'
import { FEATURE_STRIP } from '../data/landingContent.js'

// The five-item capability strip that closes the hero.
//
// Sits on the dark hero surface, so everything here is white-on-teal: icon in
// a translucent tile, short title, one line of body. Two columns on phones
// (five across would leave ~60px per item at 375px) and five from tablet up.
//
// These are `<li>`s rather than headings — the page outline is h1 (hero) then
// the h2s of the real sections, and a strip of five sub-headings inside the
// hero would flatten that outline for screen readers.

export default function FeatureStrip() {
  const { isMobile } = useBreakpoint()

  return (
    <ul
      data-hero-group
      style={{
        listStyle: 'none',
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))',
        gap: isMobile ? '20px 18px' : '24px',
        margin: 0,
        padding: '32px 0 0',
        borderTop: '1px solid rgba(255,255,255,0.18)',
      }}
    >
      {FEATURE_STRIP.map(({ icon, title, body }) => {
        const Icon = resolveIcon(icon)
        return (
          <li key={title} style={{ minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 32,
                height: 32,
                borderRadius: theme.radius.md,
                background: 'rgba(255,255,255,0.14)',
                color: '#fff',
                marginBottom: 9,
              }}
            >
              <Icon size={17} />
            </span>
            <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.01em', color: '#fff' }}>
              {title}
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,0.72)' }}>
              {body}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
