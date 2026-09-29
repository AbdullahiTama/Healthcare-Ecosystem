import { theme } from '../../../styles/theme'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { Section } from '../components/Section'
import { SectionHead } from '../components/SectionHead'
import { BUSINESS_TYPE_CARDS } from '../data/businessTypes'

// One card per real business type.
//
// This is what replaces the old "Solutions" block — three generic icon cards
// ("For Pharmacies", "For Clinics", "For Hospitals") that each said the same
// vague thing and left six of the nine supported types unmentioned on a page
// whose product supports all nine.
export function BuiltFor() {
  const { isMobileOrTablet } = useBreakpoint()
  const columns = isMobileOrTablet
    ? 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))'
    : 'repeat(3, minmax(0, 1fr))'

  return (
    <Section id="built-for" labelledBy="built-for-heading" surface="dark">
      <SectionHead
        id="built-for-heading"
        onDark
        eyebrow="Built for your sector"
        title="CareHub changes shape around your business"
        lead="Pick your business type at setup and the navigation, dashboard and vocabulary follow it. Here is what each one actually gets."
      />

      <div data-reveal-group>
        <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 14 }}>
          {BUSINESS_TYPE_CARDS.map((t) => (
            <article
              key={t.id}
              data-reveal
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: theme.radius.lg,
                padding: '22px 20px',
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                minWidth: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  background: 'rgba(255,255,255,0.10)',
                  fontSize: 18,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {t.icon}
              </span>
              <div style={{ minWidth: 0 }}>
                <h3
                  style={{
                    fontSize: 15.5,
                    fontWeight: 800,
                    color: '#ffffff',
                    letterSpacing: '-0.01em',
                    margin: '0 0 6px',
                  }}
                >
                  {t.name}
                </h3>
                <p
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    lineHeight: 1.6,
                    // 0.85 alpha over the teal band is 4.89:1.
                    color: 'rgba(255,255,255,0.85)',
                    margin: 0,
                  }}
                >
                  {t.note}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Section>
  )
}
