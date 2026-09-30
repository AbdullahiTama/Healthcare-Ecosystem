import { Link } from 'react-router-dom'
import { ArrowUpRight, Check } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { LandingSection } from '../components/LandingSection.jsx'
import ProductResultCard from '../../../healthcare-discovery/components/ProductResultCard.jsx'
import { FIXTURES, ROUTES, SEARCH_SHOWCASE } from '../data/landingContent.js'

// The search showcase. Left column walks the three decisions a user actually
// makes when looking for a medicine; right column is the real
// ProductResultCard — the same component the /search products tab renders —
// carrying the real row: seller, distance, price, WhatsApp and Call.
//
// The card's action links are inert here (the fixtures have no live seller),
// which is why the section states the query it is illustrating rather than
// implying these results are live.

function DecisionList() {
  return (
    <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 20, margin: 0, padding: 0 }}>
      {SEARCH_SHOWCASE.points.map((point, i) => (
        <li key={point.title} style={{ display: 'flex', gap: 14 }}>
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              borderRadius: theme.radius.full,
              background: theme.tealMist,
              color: theme.tealDeep,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {i + 1}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: theme.textDark, marginBottom: 4 }}>
              {point.title}
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: theme.textMid }}>
              {point.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function QuerySummary() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        flexWrap: 'wrap',
        padding: '14px 16px',
        background: theme.cardBg,
        border: `1px solid ${theme.hairline}`,
        borderRadius: theme.radius.md,
        marginBottom: 12,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.textLight }}>
        Search
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: theme.textDark }}>
        {FIXTURES.products[0].name}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: theme.tealDeep, fontWeight: 700 }}>
        <Check size={13} aria-hidden="true" />
        {FIXTURES.products[0].generic_name}
      </span>
    </div>
  )
}

export default function SearchShowcase() {
  const { isMobile } = useBreakpoint()

  return (
    <LandingSection
      id="discover"
      section="search-showcase"
      eyebrow={SEARCH_SHOWCASE.eyebrow}
      title={SEARCH_SHOWCASE.title}
      body={SEARCH_SHOWCASE.body}
      background={theme.cardBg}
      headingExtra={
        <Link
          to={ROUTES.searchProducts}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 20,
            minHeight: 44,
            fontSize: 14,
            fontWeight: 700,
            color: theme.tealDeep,
            textDecoration: 'none',
          }}
        >
          Search medicines
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div data-reveal-product>
          <QuerySummary />
          <ProductResultCard
            product={FIXTURES.products[0]}
            index={0}
            distance={FIXTURES.productDistance}
          />
          {!isMobile && (
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: theme.textLight, lineHeight: 1.5 }}>
              Illustrative result. The card, its price, distance and contact
              buttons are the same ones CareFind renders on&nbsp;/search.
            </p>
          )}
        </div>

        <div data-reveal style={{ paddingTop: 4 }}>
          <DecisionList />
        </div>
      </div>
    </LandingSection>
  )
}
