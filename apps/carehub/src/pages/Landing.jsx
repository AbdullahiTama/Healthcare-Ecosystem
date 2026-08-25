import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ShoppingCart, Package, BarChart2, Search, Users, WifiOff, MapPin,
  Clipboard, Check as CheckIcon, ArrowRight,
} from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../styles/theme'
import { BUSINESS_TYPES } from '../config/constants'
import { useBreakpoint } from '../hooks/useBreakpoint'
import LandingNav from '../components/marketing/LandingNav'
import SectionHeading from '../components/marketing/SectionHeading'
import CtaBand from '../components/marketing/CtaBand'
import SiteFooter from '../components/marketing/SiteFooter'
import { TYPE, DUOTONE, prefersReducedMotion } from '../components/marketing/tokens'
import { useRevealOnScroll } from '../components/marketing/useRevealOnScroll'
import { LANDING } from './landing/content'

gsap.registerPlugin(ScrollTrigger)

const { tealDeep, tealBright, deepTeal, tealMist, fontDisplay, bg, cardBg, navy, gray500, gray400, border } = theme

// Content names its icons as strings so content.js stays data-only.
const ICONS = { ShoppingCart, Package, BarChart2, Search, Users, WifiOff, MapPin }

// Column tracks rather than breakpoint branches, so these reflow on the space
// actually available instead of on which side of 768 the viewport falls.
const GRID = {
  pricing: 'repeat(auto-fit, minmax(220px, 1fr))',
  steps: 'repeat(auto-fit, minmax(240px, 1fr))',
}

export default function Landing() {
  const { isMobile } = useBreakpoint()
  const pageRef = useRef(null)

  // Hero entrance only; every scroll-driven reveal belongs to the shared hook.
  // The pre-rebuild page ran its whole GSAP context unconditionally — none of
  // it was reduced-motion gated.
  useEffect(() => {
    if (prefersReducedMotion()) return undefined
    const ctx = gsap.context(() => {
      gsap.from('[data-hero]', { y: 50, opacity: 0, duration: 1, stagger: 0.18, ease: 'power3.out' })
    }, pageRef)
    return () => ctx.revert()
  }, [])

  useRevealOnScroll(pageRef)

  // Native anchor, not a router Link: this scrolls within the page, and a Link
  // would push a hash route. Same contract as LandingNav's anchor targets.
  const scrollToPricing = (e) => {
    e.preventDefault()
    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const lift = (amount, shadow) => ({
    onMouseEnter: (e) => {
      if (isMobile) return
      e.currentTarget.style.transform = `translateY(-${amount}px)`
      e.currentTarget.style.boxShadow = shadow
    },
    onMouseLeave: (e) => {
      if (isMobile) return
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.boxShadow = 'none'
    },
  })

  return (
    <main ref={pageRef} style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, overflowX: 'hidden', width: '100%', maxWidth: '100%', color: navy }}>
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .ch-lift { transition: none !important; }
        }
      `}</style>

      <header>
        <LandingNav links={LANDING.nav.links} signInTo="/login" getStartedTo="/register" />
      </header>

      <section style={{
        minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden', padding: isMobile ? '120px 20px 80px' : '140px 24px 100px',
      }}>
        <img
          src={LANDING.hero.image}
          alt=""
          {...{ fetchpriority: 'high' }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: DUOTONE }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 900, margin: '0 auto' }}>
          <h1 data-hero style={{
            fontFamily: fontDisplay, fontWeight: 700, fontSize: TYPE.displayXL,
            lineHeight: 1.1, letterSpacing: '-0.02em', color: '#fff', margin: '0 0 24px',
          }}>
            {LANDING.hero.title}
          </h1>
          <p data-hero style={{ fontSize: TYPE.lead, color: 'rgba(255,255,255,0.7)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.75 }}>
            {LANDING.hero.body}
          </p>
          <div data-hero style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={LANDING.hero.primary.to} style={{
              padding: '14px 30px', borderRadius: theme.radius.md, border: 'none', background: '#fff',
              color: deepTeal, fontWeight: 800, fontSize: 14, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              {LANDING.hero.primary.label} <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <a href={LANDING.hero.secondary.target} onClick={scrollToPricing} style={{
              padding: '14px 30px', borderRadius: theme.radius.md,
              border: '1px solid rgba(255,255,255,0.3)', background: 'transparent',
              color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center',
            }}>
              {LANDING.hero.secondary.label}
            </a>
          </div>
          <div data-hero style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
            {LANDING.hero.chips.map((chip) => (
              <div key={chip} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
                <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: tealBright, flexShrink: 0 }} />
                {chip}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section data-reveal style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: gray400, marginBottom: 16 }}>
          {LANDING.businessTypes.caption}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {BUSINESS_TYPES.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 8px 8px', borderRadius: theme.radius.lg, border: `1px solid ${border}`, background: 'white', fontSize: 12.5, fontWeight: 700, color: navy }}>
              <span style={{ width: 30, height: 30, borderRadius: 10, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Clipboard size={15} aria-hidden="true" />
              </span>
              {b.name}
            </div>
          ))}
        </div>
      </section>

      <section id="features" style={{ padding: '60px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <SectionHeading {...LANDING.features.heading} />
        <div style={{ display: 'grid', gridAutoFlow: 'dense', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
          {LANDING.features.primary.map((item) => {
            const Icon = ICONS[item.icon]
            const wide = item.span && !isMobile
            return (
              <div key={item.title} className="ch-lift" data-reveal style={{
                gridColumn: wide ? 'span 2' : 'span 1',
                gridRow: wide ? 'span 2' : 'span 1',
                background: wide ? `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)` : 'white',
                borderRadius: theme.radius.xl,
                border: wide ? 'none' : `1px solid ${border}`,
                padding: wide ? 32 : 24,
                display: 'flex', flexDirection: 'column', justifyContent: wide ? 'center' : 'flex-start',
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }} {...lift(4, theme.elevation[3])}>
                <span style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: wide ? 'rgba(255,255,255,0.15)' : tealMist,
                  color: wide ? '#fff' : tealDeep,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 16,
                }}>
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div style={{ fontWeight: 800, fontSize: wide ? 18 : 14, color: wide ? '#fff' : navy, marginBottom: 8 }}>{item.title}</div>
                <div style={{ fontSize: wide ? 14 : 12.5, color: wide ? 'rgba(255,255,255,0.75)' : gray500, lineHeight: 1.65 }}>{item.desc}</div>
              </div>
            )
          })}
          {LANDING.features.secondary.map((item) => {
            const Icon = ICONS[item.icon]
            return (
              <div key={item.title} className="ch-lift" data-reveal style={{
                background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`,
                padding: 20, display: 'flex', alignItems: 'center', gap: 14,
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }} {...lift(3, theme.elevation[2])}>
                <span style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div style={{ fontWeight: 800, fontSize: 13, color: navy }}>{item.title}</div>
              </div>
            )
          })}
        </div>
      </section>

      <section id="how-it-works" style={{ background: `linear-gradient(180deg, ${theme.bg} 0%, #fff 100%)`, padding: '60px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <SectionHeading {...LANDING.steps.heading} />
          <div style={{ display: 'grid', gridTemplateColumns: GRID.steps, gap: 16 }}>
            {LANDING.steps.items.map((step, i) => (
              <div key={step.title} data-reveal style={{
                background: cardBg, borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 28,
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, borderRadius: '50%', background: tealMist, color: tealDeep,
                  fontWeight: 800, fontSize: 13, marginBottom: 14,
                }}>
                  {i + 1}
                </span>
                <div style={{ fontWeight: 800, fontSize: 15, color: navy, marginBottom: 8 }}>{step.title}</div>
                <div style={{ fontSize: 13, color: gray500, lineHeight: 1.65 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" style={{ padding: '60px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <SectionHeading {...LANDING.pricing.heading} />
        <div style={{ display: 'grid', gridTemplateColumns: GRID.pricing, gap: 12 }}>
          {LANDING.pricing.plans.map((plan) => (
            <div key={plan.name} className="ch-lift" data-reveal style={{
              background: plan.popular ? `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)` : cardBg,
              borderRadius: theme.radius.xl,
              border: plan.popular ? 'none' : `1px solid ${border}`,
              padding: isMobile ? 24 : 28,
              position: 'relative', display: 'flex', flexDirection: 'column',
              boxShadow: plan.popular ? theme.elevation[3] : 'none',
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            }}>
              {plan.popular && (
                <div style={{ position: 'absolute', top: -10, left: 20, background: '#fff', color: tealDeep, fontSize: 10, fontWeight: 800, padding: '3px 12px', borderRadius: theme.radius.full, letterSpacing: '0.04em' }}>
                  MOST POPULAR
                </div>
              )}
              <div style={{ fontWeight: 800, fontSize: 14, color: plan.popular ? '#fff' : navy, marginBottom: 10 }}>{plan.name}</div>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 28, color: plan.popular ? '#fff' : navy }}>&#8358;{plan.price}</span>
                <span style={{ fontSize: 12, color: plan.popular ? 'rgba(255,255,255,0.6)' : gray400 }}>{plan.period}</span>
              </div>
              <div style={{ marginBottom: 20, flex: 1 }}>
                {plan.items.map((it) => (
                  <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: plan.popular ? 'rgba(255,255,255,0.8)' : gray500, padding: '5px 0' }}>
                    <CheckIcon size={12} color={plan.popular ? '#fff' : tealDeep} strokeWidth={3} aria-hidden="true" />
                    {it}
                  </div>
                ))}
              </div>
              <Link to={LANDING.pricing.ctaTo} style={{
                width: '100%', padding: 12, borderRadius: theme.radius.md, boxSizing: 'border-box',
                border: plan.popular ? 'none' : `1px solid ${border}`,
                background: plan.popular ? '#fff' : 'white',
                color: plan.popular ? tealDeep : navy,
                fontWeight: 700, fontSize: 13, textDecoration: 'none', textAlign: 'center',
              }}>
                {plan.name === 'Enterprise' ? 'Talk to us' : `Start with ${plan.name}`}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section data-reveal style={{ padding: '80px 24px', maxWidth: 900, margin: '0 auto', borderTop: `1px solid ${border}`, textAlign: 'center' }}>
        <div style={{ marginBottom: 16, display: 'inline-flex', padding: '8px 16px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>
          {LANDING.referral.eyebrow}
        </div>
        <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: TYPE.displayM, color: navy, margin: '0 0 12px', lineHeight: 1.2 }}>
          {LANDING.referral.title}
        </h2>
        <p style={{ fontSize: 14.5, color: gray500, maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.7 }}>
          {LANDING.referral.bodyParts.map((part) => (
            part.strong
              ? <strong key={part.text} style={{ color: tealDeep }}>{part.text}</strong>
              : <span key={part.text}>{part.text}</span>
          ))}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Link to={LANDING.referral.cta.to} style={{
            padding: '15px 32px', borderRadius: theme.radius.md, border: 'none',
            background: tealDeep, color: '#fff', fontWeight: 800, fontSize: 14, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {LANDING.referral.cta.label} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24 }}>
          {LANDING.referral.bullets.map((bullet) => (
            <div key={bullet} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: gray500 }}>
              <CheckIcon size={13} color={tealDeep} strokeWidth={3} aria-hidden="true" />
              {bullet}
            </div>
          ))}
        </div>
      </section>

      <CtaBand {...LANDING.cta} />

      <SiteFooter {...LANDING.footer} />
    </main>
  )
}
