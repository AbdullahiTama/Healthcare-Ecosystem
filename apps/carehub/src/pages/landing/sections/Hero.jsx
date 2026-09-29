import { Link } from 'react-router-dom'
import { MoveRight } from 'lucide-react'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { theme } from '../../../styles/theme'
import { Eyebrow } from '../components/Eyebrow'
import { HeroDashboard } from './HeroDashboard'

// Three claims, each traceable to a source rather than invented:
//   business type  -> src/config/constants.js BUSINESS_TYPES
//   annual Naira   -> src/lib/planLimits.js PLAN_YEARLY_NAIRA
//   CareFind       -> docs/PROJECT_OVERVIEW.md
const TRUST = [
  'Built for your business type',
  'Plain annual pricing in Naira',
  'Discovery through CareFind',
]

// A real <Link>, not a <button onClick={navigate}>. Route changes are
// navigation and should be focusable, announced and crawlable as links.
function PrimaryCta() {
  return (
    <Link
      to="/register"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        padding: '6px 8px 6px 24px',
        background: theme.tealDeep,
        color: '#ffffff',
        borderRadius: theme.radius.full,
        fontSize: 14.5,
        fontWeight: 700,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Get started free
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.16)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MoveRight size={15} strokeWidth={2.4} />
      </span>
    </Link>
  )
}

export function Hero() {
  const { isMobile, isMobileOrTablet } = useBreakpoint()

  return (
    <section
      aria-label="CareHub"
      style={{
        background: 'var(--bg)',
        padding: isMobile ? '48px 24px 72px' : '72px 40px 96px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobileOrTablet ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1.08fr)',
          gap: isMobile ? '48px' : '56px',
          alignItems: 'center',
        }}
      >
        {/* Copy column. First in the DOM so the promise is read before the
            picture, and so a stacked mobile layout leads with words. */}
        <div data-reveal="load" style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 24 }}>
            <Eyebrow>Healthcare business operating system</Eyebrow>
          </div>

          <h1
            style={{
              fontFamily: theme.fontDisplay,
              fontWeight: 700,
              fontSize: isMobile ? 'clamp(30px, 8.4vw, 38px)' : 'clamp(40px, 5.2vw, 64px)',
              lineHeight: 1.06,
              letterSpacing: '-0.03em',
              color: theme.navy,
              margin: '0 0 22px',
              textWrap: 'balance',
            }}
          >
            Run your healthcare business from one calm workspace.
          </h1>

          <p
            style={{
              fontSize: isMobile ? 15 : 16.5,
              lineHeight: 1.65,
              fontWeight: 500,
              color: theme.gray600,
              margin: '0 0 32px',
              maxWidth: 480,
              textWrap: 'pretty',
            }}
          >
            Point of sale, inventory, staff, reports and healthcare workflow — with
            CareFind discovery built in. CareHub is the operating platform behind
            pharmacies, hospitals, clinics, laboratories and wellness businesses.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <PrimaryCta />
            <a
              href="#product"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 48,
                padding: '0 22px',
                border: `1px solid ${theme.border}`,
                background: '#ffffff',
                color: theme.navy,
                borderRadius: theme.radius.full,
                fontSize: 14.5,
                fontWeight: 700,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Explore CareHub
            </a>
          </div>

          <ul
            style={{
              listStyle: 'none',
              margin: '32px 0 0',
              padding: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px 22px',
            }}
          >
            {TRUST.map((t) => (
              <li
                key={t}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: theme.gray600,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: theme.tealDeep,
                    flexShrink: 0,
                  }}
                />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Product column. The hero's primary visual is the product itself —
            there is no stock photography on this page. */}
        <div data-reveal="load" style={{ minWidth: 0 }}>
          <HeroDashboard />
        </div>
      </div>
    </section>
  )
}
