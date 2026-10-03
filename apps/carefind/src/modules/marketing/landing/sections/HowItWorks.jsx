import { useState } from 'react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { resolveIcon } from '../components/icons.js'
import { STEPS } from '../data/landingContent.js'

// Three stages, rendered as numbered panels that widen on the active stage.
// The old version used a 600ms flex transition and a stock photo behind each
// panel; both are gone — the transition is capped at 300ms (MOTION.md:16) and
// the panels use brand colour instead of photography.
//
// On mobile the panels stack as plain cards. Every panel always shows its body
// text, so nothing is hidden behind a hover state that touch devices cannot
// reach.

const STAGE_ICONS = { search: 'Stethoscope', compare: 'Star', connect: 'MessageCircle' }

function StagePanel({ step, index, active, stacked, onActivate }) {
  const Icon = resolveIcon(STAGE_ICONS[step.id])

  return (
    <div
      onMouseEnter={() => onActivate(index)}
      onFocus={() => onActivate(index)}
      tabIndex={0}
      aria-label={`Step ${index + 1}: ${step.title}`}
      style={{
        // Stacked (mobile/tablet) every stage is full width and stays expanded;
        // side by side the active stage takes the larger share.
        flex: stacked ? '0 0 auto' : (active ? '1.6' : '1'),
        minWidth: 0,
        padding: 24,
        borderRadius: theme.radius.lg,
        background: active ? theme.navy : '#fff',
        border: `1px solid ${active ? theme.navy : theme.border}`,
        color: active ? '#fff' : theme.textDark,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: `background ${theme.motion.slow} ${theme.motion.easeOut}, border-color ${theme.motion.slow} ${theme.motion.easeOut}, flex ${theme.motion.slow} ${theme.motion.easeOut}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            borderRadius: theme.radius.full,
            background: active ? 'rgba(255,255,255,0.16)' : theme.tealMist,
            color: active ? '#fff' : theme.tealDeep,
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        <Icon
          size={18}
          color={active ? 'rgba(255,255,255,0.8)' : theme.tealDeep}
          aria-hidden="true"
        />
        <h3
          style={{
            margin: 0,
            fontSize: active ? 19 : 17,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            fontFamily: theme.fontDisplay,
          }}
        >
          {step.title}
        </h3>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.65,
          color: active ? 'rgba(255,255,255,0.8)' : theme.textMid,
        }}
      >
        {step.body}
      </p>
    </div>
  )
}

export default function HowItWorks() {
  const { isMobileOrTablet } = useBreakpoint()
  const [active, setActive] = useState(0)

  return (
    <section
      id="how-it-works"
      data-section="how-it-works"
      style={{
        background: theme.cardBg,
        padding: '96px 20px 104px',
        borderTop: `1px solid ${theme.hairline}`,
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div data-reveal style={{ textAlign: 'center', marginBottom: 56 }}>
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
            Three steps to better care
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: theme.textMid, margin: '14px auto 0', maxWidth: 520 }}>
            No account needed to search, compare or contact. You only need one to
            leave a review or pay for an appointment.
          </p>
        </div>

        <div
          data-reveal
          style={{
            // Flex, not grid: the active stage widens via `flex`, which has no
            // effect on a grid item. Mobile stacks the three stages as full-width
            // cards and every one stays expanded.
            display: 'flex',
            flexDirection: isMobileOrTablet ? 'column' : 'row',
            gap: 24,
          }}
        >
          {STEPS.map((step, i) => (
            <StagePanel
              key={step.id}
              step={step}
              index={i}
              active={isMobileOrTablet || active === i}
              stacked={isMobileOrTablet}
              onActivate={setActive}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
