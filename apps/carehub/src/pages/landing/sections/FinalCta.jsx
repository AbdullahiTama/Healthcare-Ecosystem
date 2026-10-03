import { Link } from 'react-router-dom'
import { MoveRight } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Section } from '../components/Section'

export function FinalCta() {
  return (
    <Section id="get-started" labelledBy="final-cta-heading" surface="dark">
      <div data-reveal style={{ textAlign: 'center' }}>
        <h2
          id="final-cta-heading"
          style={{
            fontFamily: theme.fontDisplay,
            fontSize: 'clamp(26px, 3.6vw, 40px)',
            fontWeight: 700,
            lineHeight: 1.14,
            letterSpacing: '-0.025em',
            color: '#ffffff',
            margin: '0 auto 16px',
            maxWidth: 620,
            textWrap: 'balance',
          }}
        >
          Your business already runs on this. It just does not have one screen yet.
        </h2>

        <p
          style={{
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1.65,
            color: 'rgba(255,255,255,0.86)',
            maxWidth: 520,
            margin: '0 auto 32px',
            textWrap: 'pretty',
          }}
        >
          Create an account, pick your business type, and start with a plan that fits. No
          implementation project and no consultant required.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <Link
            to="/register"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 11,
              minHeight: 50,
              padding: '7px 9px 7px 26px',
              background: '#ffffff',
              color: theme.navy,
              borderRadius: theme.radius.full,
              fontSize: 15,
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            Get started free
            <span
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                background: theme.tealMist,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MoveRight size={16} strokeWidth={2.4} />
            </span>
          </Link>

          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 50,
              padding: '0 26px',
              border: '1px solid rgba(255,255,255,0.32)',
              color: '#ffffff',
              borderRadius: theme.radius.full,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </Section>
  )
}
