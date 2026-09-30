import { theme } from '../../../../styles/theme'
import { resolveIcon } from '../components/icons.js'
import { TRUST } from '../data/landingContent.js'

// Trust, expressed as mechanisms rather than adjectives.
//
// The previous version of this page ran a "Trusted by" marquee naming six real
// Nigerian healthcare brands that have no relationship with CareFind, plus a
// testimonial carousel of invented patients and a "join thousands of patients"
// claim. None of it was traceable to anything in the repository, so all of it
// is gone. This section replaces those with five things a visitor can go and
// verify on any individual listing.
//
// No numbers appear here. Every item names a specific mechanism — a column, a
// workflow, a callback — so the claim is checkable rather than asserted.

export default function Trust() {
  return (
    <section
      data-section="trust"
      style={{
        background: theme.bg,
        padding: '72px 20px 80px',
        borderTop: `1px solid ${theme.hairline}`,
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div data-reveal style={{ maxWidth: 640, marginBottom: 36 }}>
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
            {TRUST.title}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: theme.textMid, margin: '14px 0 0' }}>
            {TRUST.body}
          </p>
        </div>

        <div
          data-reveal-group
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 14,
          }}
        >
          {TRUST.items.map((item) => {
            const Icon = resolveIcon(item.icon)
            return (
              <div
                key={item.title}
                style={{
                  padding: 22,
                  background: '#fff',
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.lg,
                  minWidth: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: theme.radius.md,
                    background: theme.tealMist,
                    color: theme.tealDeep,
                    display: 'grid',
                    placeItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <Icon size={19} />
                </span>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: '-0.01em',
                    color: theme.textDark,
                    marginBottom: 6,
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: theme.textMid }}>
                  {item.body}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
