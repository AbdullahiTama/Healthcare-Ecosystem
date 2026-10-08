import { theme } from '../../../styles/theme'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { Section } from '../components/Section'
import { SectionHead } from '../components/SectionHead'
import { FEATURES, STOCK_ROWS } from '../data/features'

function StockBars() {
  return (
    <div
      style={{
        background: '#ffffff',
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius.md,
        padding: 12,
        marginTop: 14,
      }}
    >
      <div style={{ display: 'grid', gap: 11 }}>
        {STOCK_ROWS.map((r) => {
          const low = r.status === 'Low stock'
          return (
            <div key={r.label}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginBottom: 5,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: theme.navy,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.label}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: low ? theme.amberText : theme.gray600,
                    flexShrink: 0,
                  }}
                >
                  {r.detail}
                </span>
              </div>
              <div
                aria-hidden
                style={{
                  height: 5,
                  borderRadius: 999,
                  background: theme.gray100,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${r.pct}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: low ? theme.warning : theme.tealDeep,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The bento resolves to one fixed composition at >=1024px (POS dominant 2x2,
// Inventory 2x1, then a field of 1x1 tiles) and degrades to plain stacked
// columns on smaller screens.
//
// The placements live in data/features.js as explicit grid coordinates rather
// than being left to auto-placement, so the composition is the same on every
// render instead of depending on source order. On phones and tablets the
// coordinates are dropped entirely — a 6-column grid at 375px would give each
// tile about 50px, which is the transform-scaling failure mode the brief rules
// out.
export function FeaturesBento() {
  const { isMobile, isTablet, isMobileOrTablet } = useBreakpoint()
  // 6 columns at >=1024 so the explicit coordinates in data/features.js can give
  // Smart POS a 3x2 block against a 3x1 Inventory tile.
  const columns = isMobile ? 1 : isTablet ? 2 : 6
  const bento = !isMobileOrTablet

  return (
    <Section id="features" labelledBy="features-heading" surface="white">
      <SectionHead
        id="features-heading"
        eyebrow="What you get"
        title="Everything a healthcare business runs on"
        lead="Thirty-two modules behind one login. The ones below are what a business touches in its first week."
      />

      <div data-reveal-group>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: 14,
            alignItems: 'stretch',
          }}
        >
          {FEATURES.map((f) => {
            const primary = !!f.primary
            const Icon = f.icon
            return (
              <article
                key={f.id}
                data-reveal
                style={{
                  gridColumn: bento ? f.dc : undefined,
                  gridRow: bento ? f.dr : undefined,
                  background: primary ? 'linear-gradient(155deg, #0E6F5A 0%, #0B4A3E 100%)' : '#ffffff',
                  border: primary ? 'none' : `1px solid ${theme.border}`,
                  borderRadius: theme.radius.xl,
                  padding: primary ? '28px 26px' : '22px 20px',
                  boxShadow: primary ? theme.elevation[3] : theme.elevation[1],
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: primary ? 44 : 38,
                    height: primary ? 44 : 38,
                    borderRadius: theme.radius.md,
                    background: primary ? 'rgba(255,255,255,0.14)' : theme.tealMist,
                    color: primary ? '#ffffff' : theme.tealDeep,
                    marginBottom: primary ? 20 : 14,
                    flexShrink: 0,
                  }}
                >
                  <Icon size={primary ? 21 : 18} />
                </div>

                <h3
                  style={{
                    fontSize: primary ? 20 : 15.5,
                    fontWeight: 800,
                    color: primary ? '#ffffff' : theme.navy,
                    letterSpacing: '-0.01em',
                    margin: '0 0 8px',
                  }}
                >
                  {f.title}
                </h3>

                <p
                  style={{
                    fontSize: primary ? 15 : 13.5,
                    fontWeight: 500,
                    lineHeight: 1.6,
                    color: primary ? 'rgba(255,255,255,0.88)' : theme.gray600,
                    margin: 0,
                  }}
                >
                  {f.body}
                </p>

                {f.embed === 'stock' && <StockBars />}
              </article>
            )
          })}
        </div>
      </div>
    </Section>
  )
}
