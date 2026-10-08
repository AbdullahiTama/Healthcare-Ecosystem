import { theme } from '../../../styles/theme'
import { BUSINESS_TYPE_CARDS } from '../data/businessTypes'

// Nine categories, in the product's own order and with the product's own
// glyphs, pulled straight from config/constants.js. This is the trust strip
// that used to be fourteen generic feature chips — it now says something
// specific: whatever kind of healthcare business you run, there is a shape of
// CareHub for it.
export function BusinessTypesStrip() {
  return (
    <section
      id="business-types"
      aria-label="Business types CareHub supports"
      style={{
        background: theme.panel || 'var(--panel)',
        borderTop: `1px solid ${theme.border}`,
        borderBottom: `1px solid ${theme.border}`,
        padding: '26px 24px',
        scrollMarginTop: '84px',
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: theme.gray600,
          textAlign: 'center',
          margin: '0 0 18px',
        }}
      >
        Built for the way your business actually runs
      </p>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '10px 12px',
        }}
      >
        {BUSINESS_TYPE_CARDS.map((t) => (
          <li
            key={t.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.full,
              fontSize: 13,
              fontWeight: 600,
              color: theme.navy,
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
              {t.icon}
            </span>
            {t.name}
          </li>
        ))}
      </ul>
    </section>
  )
}
