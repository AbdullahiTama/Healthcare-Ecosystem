import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { resolveIcon } from '../components/icons.js'
import { CATEGORIES } from '../data/landingContent.js'

// The healthcare ecosystem, rendered as tiles rather than a bullet list.
//
// Every tile is a real category from the `business_categories` seed
// (supabase/migrations/carefind_20261001_business_directory_seed.sql) or the
// medicine search surface. Tiles link to the real search tabs — Search.jsx
// reads only `?tab=` from the URL, so a category cannot be deep-linked without
// changing product behaviour, which is out of scope for a landing redesign.
//
// The first tile is given a larger cell so the grid reads as a deliberate
// composition rather than an auto-filled grid.

export default function Ecosystem() {
  const { isMobile, isMobileOrTablet } = useBreakpoint()

  return (
    <section
      id="categories"
      data-section="ecosystem"
      style={{
        background: theme.cardBg,
        padding: '72px 20px 80px',
        borderTop: `1px solid ${theme.hairline}`,
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div data-reveal style={{ maxWidth: 620, marginBottom: 32 }}>
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
            One ecosystem, every kind of provider
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: theme.textMid, margin: '14px 0 0' }}>
            From the pharmacy round the corner to the imaging centre across
            town — search them the same way, and reach them the same way.
          </p>
        </div>

        <div
          data-reveal-group
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile
              ? '1fr'
              : isMobileOrTablet
                ? 'repeat(2, minmax(0, 1fr))'
                : 'repeat(4, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          {CATEGORIES.map((category, i) => {
            const Icon = resolveIcon(category.icon)
            // The first tile spans two columns on the wide layout only.
            const lead = i === 0 && !isMobileOrTablet
            return (
              <Link
                key={category.id}
                to={category.search}
                style={{
                  gridColumn: lead ? 'span 2' : 'span 1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  minHeight: 92,
                  padding: '18px 20px',
                  background: '#fff',
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.lg,
                  textDecoration: 'none',
                  minWidth: 0,
                  transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: theme.radius.md,
                    background: theme.tealMist,
                    color: theme.tealDeep,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={20} />
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: theme.textDark,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {category.label}
                  </span>
                  <ArrowUpRight size={15} color={theme.gray400} aria-hidden="true" />
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
