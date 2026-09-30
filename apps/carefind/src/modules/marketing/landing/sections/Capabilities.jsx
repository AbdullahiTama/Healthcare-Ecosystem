import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { LandingSection } from '../components/LandingSection.jsx'
import { resolveIcon } from '../components/icons.js'
import { CAPABILITIES } from '../data/landingContent.js'

// "What you can do" — the four capability cards (Ask / Discover / Connect /
// Book). Each card is a real link to the CareFind surface that performs it, so
// the section advertises nothing the codebase cannot do. One column on phones,
// two at tablet, four from laptop up.

export default function Capabilities() {
  const { isMobile, isMobileOrTablet } = useBreakpoint()

  const columns = isMobile
    ? 'minmax(0, 1fr)'
    : isMobileOrTablet
      ? 'repeat(2, minmax(0, 1fr))'
      : 'repeat(4, minmax(0, 1fr))'

  return (
    <LandingSection
      id="what-you-can-do"
      section="capabilities"
      eyebrow={CAPABILITIES.eyebrow}
      title={CAPABILITIES.title}
      body={CAPABILITIES.body}
      background={theme.bg}
      align="center"
    >
      <div
        data-reveal-group
        style={{
          display: 'grid',
          gridTemplateColumns: columns,
          gap: 14,
          textAlign: 'left',
        }}
      >
        {CAPABILITIES.items.map((item) => {
          const Icon = resolveIcon(item.icon)
          return (
            <Link
              key={item.id}
              to={item.to}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minHeight: 172,
                padding: '20px 18px 18px',
                background: '#fff',
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radius.lg,
                textDecoration: 'none',
                color: theme.textDark,
                minWidth: 0,
                transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 38,
                    height: 38,
                    borderRadius: theme.radius.md,
                    background: theme.tealMist,
                    color: theme.tealDeep,
                  }}
                >
                  <Icon size={19} />
                </span>
                <ArrowUpRight size={17} color={theme.navySoft} aria-hidden="true" />
              </span>
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>
                {item.title}
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.6, color: theme.textMid }}>
                {item.body}
              </span>
            </Link>
          )
        })}
      </div>
    </LandingSection>
  )
}
