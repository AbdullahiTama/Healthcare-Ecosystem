import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Section } from '../components/Section'
import { SectionHead } from '../components/SectionHead'
import { PLAN_LIMITS, PLAN_LABELS, PLAN_YEARLY_NAIRA, PLAN_MONTHLY_NAIRA, isPlanAllowedForBusinessType } from '../../../lib/planLimits'

// Prices and limits are read from lib/planLimits.js rather than typed here —
// that file is the single source of truth for both the client and
// api/initiate-plan-payment.js, which looks the price up server-side instead of
// trusting what the browser sends. A second hand-copied price list on the
// marketing page is exactly how those two drift apart.
//
// Two claims the previous page made have been dropped because they are not
// implemented anywhere in the codebase:
//   - "30-day free trial"  — no trial logic exists in the payment flow
//   - "Save 20% annually"  — PLAN_MONTHLY_NAIRA is yearly/12, so annual is not
//                            cheaper and there is no saving to advertise
// Every plan is billed annually. Custom is negotiated and carries no price.

// Modules every plan includes. These are the same on all five plans — that is
// the point of them — so the table states it rather than leaving the visitor to
// assume the pricier plans unlock modules the cheap one cannot do.
const MODULE_ROWS = [
  { label: 'Point of sale' },
  { label: 'Inventory' },
  { label: 'Reports' },
  { label: 'Staff & roles' },
  { label: 'CareFind listing' },
  { label: 'Multi-location' },
]

// The four priced plans, which are genuine peers and share one grid. Custom is
// a different motion — a conversation, not a checkout — so it gets its own band
// below rather than a fifth card sitting at a different height. Five cards in
// one row is also what produced the old page's 180px-wide columns.
const PEER_PLANS = ['basic', 'growth', 'premium', 'enterprise']
const TABLE_PLANS = [...PEER_PLANS, 'custom']

const PLAN_SUMMARY = {
  basic: 'One counter moving off paper records.',
  growth: 'Staff, more than one counter, and stock that has to be right.',
  premium: 'Several locations run as one business.',
  enterprise: 'Hospital groups and large networks.',
  custom: 'Procurement, hosting and compliance requirements.',
}

const POPULAR = 'growth'

const UNLIMITED = 'Unlimited'

function limitValue(n) {
  return n === Infinity ? UNLIMITED : n.toLocaleString('en-NG')
}

function priceFor(plan) {
  const n = PLAN_YEARLY_NAIRA[plan]
  if (n === null) return null
  return `₦${n.toLocaleString('en-NG')}`
}

// PLAN_MONTHLY_NAIRA is derived as yearly/12, so it is an equivalence, never a
// second price. Labelled as such because monthly billing does not exist.
function monthlyFor(plan) {
  const n = PLAN_MONTHLY_NAIRA[plan]
  if (n === null || n === undefined) return null
  return `≈ ₦${n.toLocaleString('en-NG')}`
}

function PlanButton({ plan, primary }) {
  if (plan === 'custom') {
    return (
      <a
        href="mailto:support@carehub.ng?subject=CareHub%20Custom%20plan"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: 44,
          padding: '0 18px',
          border: `1px solid ${primary ? theme.tealDeep : theme.border}`,
          borderRadius: theme.radius.md,
          background: primary ? theme.tealDeep : '#ffffff',
          color: primary ? '#ffffff' : theme.navy,
          fontSize: 14,
          fontWeight: 700,
          textDecoration: 'none',
          textAlign: 'center',
        }}
      >
        Contact sales
      </a>
    )
  }

  return (
    <Link
      to="/register"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        minHeight: 44,
        padding: '0 18px',
        border: `1px solid ${primary ? theme.tealDeep : theme.border}`,
        borderRadius: theme.radius.md,
        background: primary ? theme.tealDeep : '#ffffff',
        color: primary ? '#ffffff' : theme.navy,
        fontSize: 14,
        fontWeight: 700,
        textDecoration: 'none',
        textAlign: 'center',
      }}
    >
      Get started free
    </Link>
  )
}

export function PricingSection() {
  return (
    <Section id="pricing" labelledBy="pricing-heading" surface="bg">
      <SectionHead
        id="pricing-heading"
        eyebrow="Pricing"
        title="Annual plans, in naira, with the limits in the open"
        lead="Every plan includes the full module set. What changes is scale — how many staff, locations and products you can run."
      />

      <div data-reveal-group>
        {/* Plan cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))',
            gap: 14,
            alignItems: 'stretch',
            marginBottom: 48,
          }}
        >
          {PEER_PLANS.map((plan) => {
            const primary = plan === POPULAR
            const price = priceFor(plan)
            const monthly = monthlyFor(plan)
            const limits = PLAN_LIMITS[plan]
            const allowedForHospitals = isPlanAllowedForBusinessType(plan, 'hospital')
            return (
              <article
                key={plan}
                data-reveal
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#ffffff',
                  border: `1px solid ${primary ? theme.tealDeep : theme.border}`,
                  borderRadius: theme.radius.xl,
                  padding: '24px 20px',
                  boxShadow: primary ? theme.elevation[3] : theme.elevation[1],
                  minWidth: 0,
                }}
              >
                {primary && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -11,
                      left: 20,
                      fontSize: 10.5,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: '#ffffff',
                      background: theme.tealDeep,
                      borderRadius: theme.radius.full,
                      padding: '4px 12px',
                    }}
                  >
                    Most popular
                  </span>
                )}

                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: theme.navy,
                    margin: primary ? '6px 0 4px' : '0 0 4px',
                  }}
                >
                  {PLAN_LABELS[plan]}
                </h3>
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.55,
                    color: theme.gray600,
                    margin: '0 0 18px',
                    minHeight: 40,
                  }}
                >
                  {PLAN_SUMMARY[plan]}
                </p>

                {price ? (
                  <div style={{ marginBottom: 6 }}>
                    <span
                      style={{
                        fontFamily: theme.fontDisplay,
                        fontSize: 30,
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        color: theme.navy,
                      }}
                    >
                      {price}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: theme.gray600,
                        marginLeft: 6,
                      }}
                    >
                      / year
                    </span>
                  </div>
                ) : null}

                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: theme.gray600,
                    marginBottom: 18,
                  }}
                >
                  {price ? `${monthly} / month, billed annually.` : 'Priced to your requirements.'}
                </div>

                {/* A real product constraint, read from planLimits rather than
                    asserted in copy. It is also a trust signal: the page admits
                    what it will not sell you. */}
                {!allowedForHospitals && (
                  <p
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      lineHeight: 1.5,
                      color: theme.gray600,
                      margin: '-8px 0 14px',
                      padding: '9px 11px',
                      background: 'var(--bg)',
                      border: `1px solid ${theme.border}`,
                      borderRadius: theme.radius.md,
                    }}
                  >
                    Not available for hospitals.
                  </p>
                )}

                <ul
                  style={{
                    listStyle: 'none',
                    margin: '0 0 20px',
                    padding: 0,
                    display: 'grid',
                    gap: 9,
                    flex: '1 1 auto',
                  }}
                >
                  {[
                    `${limitValue(limits.maxStaff)} staff`,
                    `${limitValue(limits.maxLocations)} ${
                      limits.maxLocations === 1 ? 'location' : 'locations'
                    }`,
                    `${limitValue(limits.maxProducts)} products`,
                  ].map((row) => (
                    <li
                      key={row}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        fontSize: 13,
                        fontWeight: 600,
                        color: theme.gray600,
                      }}
                    >
                      <Check
                        size={14}
                        style={{ color: theme.tealDeep, flexShrink: 0 }}
                        aria-hidden
                      />
                      {row}
                    </li>
                  ))}
                </ul>

                <PlanButton plan={plan} primary={primary} />
              </article>
            )
          })}
        </div>

        {/* Custom is a sales conversation, not a fifth price tier. It gets a
            full-width band so the four priced plans above stay visually equal. */}
        <div
          data-reveal
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            background: '#ffffff',
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius.xl,
            padding: '24px 26px',
            marginBottom: 48,
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <h3
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: theme.navy,
                margin: '0 0 4px',
              }}
            >
              Bespoke
            </h3>
            <p
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: 1.55,
                color: theme.gray600,
                margin: 0,
              }}
            >
              {PLAN_SUMMARY.custom} Limits are agreed in writing rather than set by us.
            </p>
          </div>
          {/* flex-basis, not min-width: the sales button has to keep its label on
              one line, but a fixed minimum would push the band wider than a
              320px viewport. flex-shrink lets it reflow below the text. */}
          <div style={{ flex: '0 1 auto', minWidth: 0, flexBasis: 180 }}>
            <PlanButton plan="custom" />
          </div>
        </div>

        {/* Accessible comparison table. A real <table> with a <caption> and
            scoped headers, not a grid of divs — the previous "compare plans"
            block was visual-only and unreadable to a screen reader. */}
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              minWidth: 560,
              borderCollapse: 'collapse',
              background: '#ffffff',
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.lg,
              overflow: 'hidden',
            }}
          >
            <caption
              style={{
                captionSide: 'top',
                textAlign: 'left',
                padding: '18px 20px 0',
                fontSize: 14,
                fontWeight: 800,
                color: theme.navy,
              }}
            >
              Plan limits side by side
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{
                    textAlign: 'left',
                    padding: '14px 20px',
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: theme.gray600,
                    borderBottom: `1px solid ${theme.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Limit
                </th>
                {TABLE_PLANS.map((plan) => (
                  <th
                    key={plan}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '14px 20px',
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: plan === POPULAR ? theme.tealDeep : theme.gray600,
                      borderBottom: `1px solid ${theme.border}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {PLAN_LABELS[plan]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'maxStaff', label: 'Staff' },
                { key: 'maxLocations', label: 'Locations' },
                { key: 'maxProducts', label: 'Products' },
              ].map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    style={{
                      textAlign: 'left',
                      padding: '13px 20px',
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: theme.navy,
                      borderBottom: `1px solid ${theme.border}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.label}
                  </th>
                  {TABLE_PLANS.map((plan) => (
                    <td
                      key={plan}
                      style={{
                        padding: '13px 20px',
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: theme.gray600,
                        borderBottom: `1px solid ${theme.border}`,
                      }}
                    >
                      {limitValue(PLAN_LIMITS[plan][row.key])}
                    </td>
                  ))}
                </tr>
              ))}

              {MODULE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    style={{
                      textAlign: 'left',
                      padding: '13px 20px',
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: theme.navy,
                      borderBottom: `1px solid ${theme.border}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.label}
                  </th>
                  {TABLE_PLANS.map((plan) => (
                    <td
                      key={plan}
                      style={{
                        padding: '13px 20px',
                        borderBottom: `1px solid ${theme.border}`,
                      }}
                    >
                      <Check
                        size={15}
                        aria-label="Included"
                        style={{ color: theme.tealDeep, display: 'block' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}

              <tr>
                <th
                  scope="row"
                  style={{
                    textAlign: 'left',
                    padding: '13px 20px',
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: theme.navy,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Annual price
                </th>
                {TABLE_PLANS.map((plan) => (
                  <td
                    key={plan}
                    style={{
                      padding: '13px 20px',
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: theme.navy,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {priceFor(plan) || 'Custom'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <p
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            lineHeight: 1.6,
            color: theme.gray600,
            margin: '16px 0 0',
            maxWidth: 760,
          }}
        >
          Every plan includes the full module set — the rows above are identical across
          all five because a plan buys scale, not features. Upgrade and downgrade from
          Settings at any time.
        </p>
      </div>
    </Section>
  )
}
