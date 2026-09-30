import { Link } from 'react-router-dom'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { resolveIcon } from '../components/icons.js'
import { FEATURES } from '../data/landingContent.js'

// The bento. Six real capabilities, laid out asymmetrically so the section has
// editorial rhythm rather than a uniform 3×2 grid.
//
// One accent only: every cell uses tealMist + tealDeep. No card-on-card
// nesting (DESIGN_CHECKLIST.md:98) — each cell is a single bordered surface.
//
// "Verified professionals" and "Claimed businesses" are deliberately separate
// cells. Verification is a real DB-backed column for people
// (profiles.is_verified); businesses have a claim-and-approval workflow
// instead. Conflating them into one "verified providers" claim would assert
// something the schema does not support.

const SPAN = {
  // Which grid cells each feature occupies on the laptop-and-up layout.
  medicines: 'wide',
  professionals: 'tall',
  businesses: 'default',
  reviews: 'wide',
  contact: 'default',
  appointments: 'default',
}

function FeatureCard({ feature, layout }) {
  const Icon = resolveIcon(feature.icon)
  const wide = layout === 'wide'

  return (
    <Link
      to={feature.to}
      data-reveal
      style={{
        gridColumn: wide ? 'span 2' : 'span 1',
        display: 'flex',
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'center' : 'flex-start',
        gap: wide ? 20 : 0,
        padding: wide ? '24px 28px' : 24,
        background: '#fff',
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius.lg,
        textDecoration: 'none',
        minWidth: 0,
        height: '100%',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 42,
          height: 42,
          borderRadius: theme.radius.md,
          background: theme.tealMist,
          color: theme.tealDeep,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          marginBottom: wide ? 0 : 16,
        }}
      >
        <Icon size={21} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3
          style={{
            margin: 0,
            fontSize: wide ? 17 : 15,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: theme.textDark,
            marginBottom: 6,
          }}
        >
          {feature.title}
        </h3>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: theme.textMid, maxWidth: 420 }}>
          {feature.body}
        </p>
      </div>
    </Link>
  )
}

export default function DiscoveryFeatures() {
  const { isMobileOrTablet } = useBreakpoint()

  return (
    <section
      data-section="features"
      style={{
        background: theme.bg,
        padding: '72px 20px 80px',
        borderTop: `1px solid ${theme.hairline}`,
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div data-reveal style={{ maxWidth: 620, marginBottom: 36 }}>
          <h2
            style={{
              fontFamily: theme.fontDisplay,
              fontWeight: 900,
              fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)',
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: theme.textDark,
              margin: 0,
              textWrap: 'balance',
            }}
          >
            Everything you need, in one place
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: theme.textMid, margin: '14px 0 0' }}>
            Each of these is something CareFind does today — search a medicine,
            see who is verified, read who wrote a review, message a provider,
            book a slot and pay for it.
          </p>
        </div>

        <div
          data-reveal-group
          style={{
            display: 'grid',
            gridTemplateColumns: isMobileOrTablet ? '1fr' : 'repeat(3, minmax(0, 1fr))',
            gap: 14,
            alignItems: 'stretch',
          }}
        >
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} layout={SPAN[feature.id]} />
          ))}
        </div>
      </div>
    </section>
  )
}
