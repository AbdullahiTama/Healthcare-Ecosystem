import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Star } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { Eyebrow } from '../components/LandingSection.jsx'
import ProductPreview from '../components/ProductPreview.jsx'
import { HERO } from '../data/landingContent.js'

// The hero. The product is the subject — the headline and copy sit in their own
// column and the real CareFind search UI sits beside them, not behind a
// full-bleed stock photograph. No image, no gradient, no invented statistic.
//
// Lays out stacked on mobile/tablet and as two columns from laptop up, where the
// copy column narrows and the product column takes the larger share — the
// product is the wider half because it is the point of the page.

function HeroCopy() {
  return (
    <div style={{ minWidth: 0 }}>
      <div data-hero>
        <Eyebrow>{HERO.eyebrow}</Eyebrow>
        <h1
          style={{
            fontFamily: theme.fontDisplay,
            fontWeight: 900,
            fontSize: 'clamp(2.2rem, 5vw, 3.6rem)',
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
            color: theme.textDark,
            margin: 0,
            textWrap: 'balance',
          }}
        >
          {HERO.title}
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.7,
            color: theme.textMid,
            margin: '18px 0 0',
            maxWidth: 460,
          }}
        >
          {HERO.body}
        </p>
      </div>

      <div data-hero style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
        <Link
          to={HERO.primary.to}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 48,
            padding: '0 26px',
            borderRadius: theme.radius.full,
            background: theme.tealDeep,
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
          }}
        >
          {HERO.primary.label}
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
        <Link
          to={HERO.secondary.to}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 48,
            padding: '0 26px',
            borderRadius: theme.radius.full,
            background: '#fff',
            border: `1px solid ${theme.border}`,
            color: theme.textDark,
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
          }}
        >
          {HERO.secondary.label}
        </Link>
      </div>

      {/* Three capability chips, no numbers. They restate what the page below
          demonstrates rather than adding a new claim. */}
      <ul
        data-hero
        style={{
          listStyle: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 20px',
          margin: '32px 0 0',
          padding: 0,
        }}
      >
        {[
          { icon: MapPin, label: 'Distance-aware results' },
          { icon: Star, label: 'Reviews with named reviewers' },
        ].map(({ icon: Icon, label }) => (
          <li key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: theme.textMid, fontWeight: 600 }}>
            <Icon size={15} color={theme.tealDeep} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Hero() {
  const { isMobileOrTablet } = useBreakpoint()

  return (
    <section
      data-section="hero"
      style={{
        background: theme.bg,
        padding: '48px 20px 72px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobileOrTablet ? '1fr' : 'minmax(0, 0.88fr) minmax(0, 1.12fr)',
          gap: isMobileOrTablet ? 36 : 56,
          alignItems: 'center',
        }}
      >
        <HeroCopy />

        <div data-hero style={{ minWidth: 0 }}>
          <ProductPreview
            query={HERO.preview.query}
            location={HERO.preview.location}
            disclaimer={HERO.preview.disclaimer}
          />
        </div>
      </div>
    </section>
  )
}
