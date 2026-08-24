import { useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Search, Star, MessageCircle, Shield } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import LandingNav from './components/LandingNav'
import Marquee from './components/Marquee'
import SectionHeading from './components/SectionHeading'
import CtaBand from './components/CtaBand'
import SiteFooter from './components/SiteFooter'
import { TYPE, DUOTONE, prefersReducedMotion } from './components/tokens'
import { useRevealOnScroll } from './components/useRevealOnScroll'
import { HOME } from './content'

gsap.registerPlugin(ScrollTrigger)

const FEATURE_ICONS = { Search, Star, MessageCircle, Shield }

const { tealDeep, tealBright, navy, navySoft, bg, cardBg, border, textDark, textMid, textLight } = theme

const ICON_TONES = [tealDeep, tealBright, navySoft, navy]

function FeatureCard({ icon, title, desc, tone }) {
  const Icon = icon
  return (
    <div className="feature-card" data-reveal style={{
      background: cardBg, borderRadius: theme.radius.xl, padding: 28, border: `1px solid ${border}`,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, background: `${tone}15`, color: tone, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 16 }}>
        <Icon size={22} aria-hidden="true" />
      </div>
      <div style={{ fontWeight: 800, fontSize: 15, color: textDark, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: textMid, lineHeight: 1.65, flex: 1 }}>{desc}</div>
    </div>
  )
}

export default function Home() {
  const pageRef = useRef(null)
  const { isMobile } = useBreakpoint()
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    if (prefersReducedMotion()) return undefined
    const ctx = gsap.context(() => {
      gsap.from('[data-hero]', {
        y: 60, opacity: 0, duration: 1, stagger: 0.2, ease: 'power3.out',
      })
    }, pageRef)
    return () => ctx.revert()
  }, [])

  useRevealOnScroll(pageRef)

  const renderStepBody = (step, index, { active }) => (
    <>
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.3,
        backgroundImage: `url(${step.image})`, backgroundSize: 'cover', backgroundPosition: 'center',
      }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(11,74,62,0.95) 0%, rgba(11,74,62,0.3) 60%, rgba(11,74,62,0.1) 100%)' }} />
      <div style={{ position: 'relative', zIndex: 1, padding: isMobile ? 20 : 24, width: '100%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 11, fontWeight: 800, marginBottom: 10 }}>{index + 1}</div>
        <div style={{ fontWeight: 800, fontSize: active ? 18 : 15, color: '#fff', marginBottom: active ? 8 : 0, transition: 'all 0.4s ease' }}>{step.title}</div>
        {active && <div style={{ fontSize: isMobile ? 12.5 : 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, maxWidth: 360 }}>{step.desc}</div>}
      </div>
    </>
  )

  const stepSurface = {
    borderRadius: theme.radius.xl, overflow: 'hidden',
    background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 100%)`,
    position: 'relative', display: 'flex', alignItems: 'flex-end',
    minHeight: 320, color: '#fff',
  }

  return (
    <main ref={pageRef} style={{ fontFamily: theme.fontFamily, background: bg, color: textDark, overflowX: 'hidden', minHeight: '100vh', width: '100%', maxWidth: '100%' }}>
      <header>
        <LandingNav links={HOME.nav.links} signInTo="/login" getStartedTo="/search" />
      </header>

      <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <img
          src={HOME.hero.image}
          alt=""
          {...{ fetchpriority: 'high' }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: DUOTONE }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '120px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
          <h1 data-hero style={{ fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: TYPE.displayXL, lineHeight: 1.08, letterSpacing: '-0.03em', color: '#fff', margin: '0 0 14px' }}>
            {HOME.hero.title}
          </h1>
          <p data-hero style={{ fontSize: TYPE.lead, color: 'rgba(255,255,255,0.78)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.7 }}>
            {HOME.hero.body}
          </p>
          <div data-hero style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/search" style={{ padding: '16px 32px', borderRadius: 60, textDecoration: 'none', border: 'none', background: '#fff', color: navy, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Start searching <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link to="/feed" style={{ padding: '16px 32px', borderRadius: 60, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Browse feed
            </Link>
          </div>
          <div data-hero style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', marginTop: 36 }}>
            {HOME.hero.trustChips.map((chip) => (
              <span key={chip} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
                {chip}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section data-reveal style={{ padding: '64px 0', overflow: 'hidden', background: bg }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: textLight, textAlign: 'center', marginBottom: 20, padding: '0 24px' }}>
          {HOME.categories.label}
        </div>
        <Marquee items={HOME.categories.items} label={HOME.categories.label} />
      </section>

      <section id="features" style={{ padding: '80px 24px 96px', maxWidth: 1100, margin: '0 auto' }}>
        <SectionHeading {...HOME.features.heading} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 16, gridAutoFlow: 'dense' }}>
          {HOME.features.items.map((item, i) => (
            <FeatureCard key={item.title} icon={FEATURE_ICONS[item.icon]} title={item.title} desc={item.desc} tone={ICON_TONES[i % ICON_TONES.length]} />
          ))}
        </div>
      </section>

      <section id="how-it-works" style={{ padding: '80px 24px 96px', background: cardBg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <SectionHeading {...HOME.steps.heading} />
          <div data-reveal style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, minHeight: isMobile ? undefined : 360 }}>
            {isMobile
              ? HOME.steps.items.map((step, i) => (
                <div key={step.title} style={stepSurface}>
                  {renderStepBody(step, i, { active: true })}
                </div>
              ))
              : HOME.steps.items.map((step, i) => (
                <button
                  key={step.title}
                  type="button"
                  aria-expanded={activeStep === i}
                  onMouseEnter={() => setActiveStep(i)}
                  onFocus={() => setActiveStep(i)}
                  onClick={() => setActiveStep(i)}
                  style={{
                    ...stepSurface,
                    flex: activeStep === i ? 3 : 1, minWidth: 0,
                    textAlign: 'left', border: 'none', cursor: 'pointer', padding: 0,
                    fontFamily: 'inherit',
                    transition: 'flex 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {renderStepBody(step, i, { active: activeStep === i })}
                </button>
              ))}
          </div>
        </div>
      </section>

      <CtaBand {...HOME.cta} />

      <SiteFooter brandLine={HOME.footer.brandLine} links={HOME.footer.links} />
    </main>
  )
}
