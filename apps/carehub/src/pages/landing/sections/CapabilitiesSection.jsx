import { Link } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { Section } from '../components/Section'
import { SectionHead } from '../components/SectionHead'
import { CAPABILITIES, CAPABILITY_NOTE } from '../data/capabilities'

// Four numbers, and they are the only four on the page.
//
// The repository contains no customer count, no usage volume, no uptime figure
// and no benchmark. The previous page's trust band ("500+ businesses",
// "10,000+ patients managed", "99.9% uptime") was pure invention — the only
// real numbers in the audit were a security audit's own table counts. Rather
// than repeat that, the section states the platform's actual scale and says
// plainly that these are capability figures, not usage statistics.
export function CapabilitiesSection() {
  return (
    <Section id="capabilities" labelledBy="capabilities-heading" surface="white">
      <SectionHead
        id="capabilities-heading"
        eyebrow="The scale of the platform"
        title="Measured from the product, not from a pitch deck"
        lead="Every figure below is a structural fact read out of the CareHub codebase. We would rather show you what exists than what we wish existed."
      />

      <div data-reveal-group>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
            gap: 16,
            margin: 0,
          }}
        >
          {CAPABILITIES.map((c) => (
            <div
              key={c.label}
              data-reveal
              style={{
                background: 'var(--bg)',
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radius.xl,
                padding: '24px 20px',
                minWidth: 0,
              }}
            >
              <dd
                style={{
                  margin: 0,
                  fontFamily: theme.fontDisplay,
                  fontSize: 44,
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  // tealDeep is 5.60:1 on --bg.
                  color: theme.tealDeep,
                }}
              >
                {c.value}
              </dd>
              <dt
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: theme.navy,
                  margin: '12px 0 6px',
                }}
              >
                {c.label}
              </dt>
              <dd
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  fontWeight: 500,
                  lineHeight: 1.55,
                  // gray600 is 5.17:1 on --bg.
                  color: theme.gray600,
                }}
              >
                {c.detail}
              </dd>
            </div>
          ))}
        </dl>

        <p
          style={{
            textAlign: 'center',
            margin: '28px 0 0',
            fontSize: 12,
            fontWeight: 600,
            color: theme.gray600,
          }}
        >
          {CAPABILITY_NOTE}{' '}
          <Link
            to="/register"
            style={{ color: theme.tealDeep, fontWeight: 700, textDecoration: 'underline' }}
          >
            Create an account
          </Link>{' '}
          and count them yourself.
        </p>
      </div>
    </Section>
  )
}
