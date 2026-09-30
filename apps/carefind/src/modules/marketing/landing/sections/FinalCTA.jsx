import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { Eyebrow } from '../components/LandingSection.jsx'
import { FINAL_CTA } from '../data/landingContent.js'

// The closing band.
//
// This is the one place a dark surface is used on the page, and it is permitted:
// the design system reserves brand gradients for marketing and hero surfaces
// (packages/design-system/src/theme.js:92, docs/design/COLORS.md:110). It is
// the last thing on the page, so nothing has to reconcile with it.
//
// The secondary action goes to /claim-business, which is behind RequireAuth —
// an anonymous visitor is redirected to sign in. That is the correct behaviour
// (a claim must belong to an account), so the copy names the action rather than
// hiding the gate.

export default function FinalCTA() {
  return (
    <section
      data-section="final-cta"
      style={{
        background: theme.navy,
        padding: '96px 20px 104px',
      }}
    >
      <div style={{ maxWidth: 660, margin: '0 auto', textAlign: 'center' }}>
        <div data-reveal>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Eyebrow tone="dark">Get started</Eyebrow>
          </div>
          <h2
            style={{
              fontFamily: theme.fontDisplay,
              fontWeight: 900,
              fontSize: 'clamp(1.8rem, 3.6vw, 2.8rem)',
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              color: '#fff',
              margin: 0,
              textWrap: 'balance',
            }}
          >
            {FINAL_CTA.title}
          </h2>
          <p
            style={{
              fontSize: 15.5,
              lineHeight: 1.7,
              color: 'rgba(255,255,255,0.76)',
              margin: '20px auto 0',
              maxWidth: 520,
            }}
          >
            {FINAL_CTA.body}
          </p>
        </div>

        <div
          data-reveal
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 40 }}
        >
          <Link
            to={FINAL_CTA.primary.to}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 48,
              padding: '0 28px',
              borderRadius: theme.radius.full,
              background: '#fff',
              color: theme.navy,
              fontWeight: 800,
              fontSize: 15,
              textDecoration: 'none',
            }}
          >
            {FINAL_CTA.primary.label}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link
            to={FINAL_CTA.secondary.to}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 48,
              padding: '0 28px',
              borderRadius: theme.radius.full,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.34)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              textDecoration: 'none',
            }}
          >
            {FINAL_CTA.secondary.label}
          </Link>
        </div>
      </div>
    </section>
  )
}
