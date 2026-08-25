import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Building2, Compass, Eye, HeartHandshake, HeartPulse, MessageCircle,
  Newspaper, Star, Target, Users,
} from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import LandingNav from './components/LandingNav'
import SectionHeading from './components/SectionHeading'
import CtaBand from './components/CtaBand'
import SiteFooter from './components/SiteFooter'
import { TYPE, DUOTONE, prefersReducedMotion } from './components/tokens'
import { useRevealOnScroll } from './components/useRevealOnScroll'
import { ABOUT } from './content'

gsap.registerPlugin(ScrollTrigger)

// Content names its icons as strings so content.js stays data-only; the page
// owns the mapping. Same arrangement as Home.jsx's FEATURE_ICONS.
const ICONS = { Building2, Compass, Eye, HeartHandshake, MessageCircle, Newspaper, Star, Target, Users }

const { tealDeep, navy, navySoft, bg, cardBg, border, textDark, textMid, textLight } = theme

function Eyebrow({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: tealDeep, marginBottom: 12,
    }}>
      {children}
    </div>
  )
}

function ProseParagraph({ lead = false, children }) {
  return (
    <p style={{
      fontSize: lead ? 17 : 15,
      color: lead ? textDark : textMid,
      lineHeight: lead ? 1.8 : 1.7,
      fontWeight: lead ? 500 : 400,
      maxWidth: 640, margin: '0 0 16px',
    }}>
      {children}
    </p>
  )
}

// The mission/vision goal and the offerings footnote were byte-identical dashed
// boxes in the pre-rebuild page. One component, used twice.
function DashedNote({ label, body }) {
  return (
    <div data-reveal style={{
      marginTop: 18, padding: 24, borderRadius: theme.radius.lg,
      border: `1px dashed ${border}`, textAlign: 'center',
    }}>
      <p style={{ fontSize: 14.5, color: textMid, lineHeight: 1.8, margin: 0 }}>
        <strong style={{ color: tealDeep, fontWeight: 800 }}>{label}</strong>
        {body}
      </p>
    </div>
  )
}

function IconTile({ name, dark = false }) {
  const Icon = ICONS[name]
  return (
    <div style={{
      width: 44, height: 44, borderRadius: 14, marginBottom: 16,
      background: dark ? 'rgba(255,255,255,0.12)' : `${tealDeep}15`,
      color: dark ? '#fff' : tealDeep,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={22} aria-hidden="true" />
    </div>
  )
}

export default function About() {
  const { isMobile } = useBreakpoint()
  const pageRef = useRef(null)

  // Hero entrance only. Every scroll-driven reveal belongs to the shared hook,
  // which no-ops under reduced motion; this effect gates itself the same way.
  useEffect(() => {
    if (prefersReducedMotion()) return undefined
    const ctx = gsap.context(() => {
      gsap.from('[data-hero]', { y: 40, opacity: 0, duration: 1, stagger: 0.16, ease: 'power3.out' })
    }, pageRef)
    return () => ctx.revert()
  }, [])

  useRevealOnScroll(pageRef)

  // Native anchor rather than a router Link: this scrolls within the page, and
  // a Link would push a hash route instead.
  const scrollToStory = (e) => {
    e.preventDefault()
    document.getElementById('story')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const cardSurface = {
    background: bg, borderRadius: theme.radius.xl, padding: 32, border: `1px solid ${border}`,
  }

  return (
    <main ref={pageRef} style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, color: textDark, overflowX: 'hidden', width: '100%', maxWidth: '100%' }}>
      <header>
        <LandingNav links={ABOUT.nav.links} signInTo="/login" getStartedTo="/search" />
      </header>

      <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <img
          src={ABOUT.hero.image}
          alt=""
          {...{ fetchpriority: 'high' }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: DUOTONE }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '120px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
          <div data-hero style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 40,
            border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)',
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)', marginBottom: 18,
          }}>
            <HeartPulse size={14} aria-hidden="true" />
            {ABOUT.hero.badge}
          </div>
          <h1 data-hero style={{
            fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: TYPE.displayXL,
            lineHeight: 1.1, letterSpacing: '-0.03em', color: '#fff', margin: '0 0 18px',
          }}>
            {ABOUT.hero.title}
          </h1>
          <p data-hero style={{ fontSize: TYPE.lead, color: 'rgba(255,255,255,0.78)', maxWidth: 620, margin: '0 auto 36px', lineHeight: 1.8 }}>
            {ABOUT.hero.body}
          </p>
          <div data-hero style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a href={ABOUT.hero.actions.primary.target} onClick={scrollToStory} style={{
              padding: '16px 32px', borderRadius: 60, border: 'none', background: '#fff',
              color: navy, fontWeight: 800, fontSize: 15, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              {ABOUT.hero.actions.primary.label} <ArrowRight size={18} aria-hidden="true" />
            </a>
            <Link to={ABOUT.hero.actions.secondary.to} style={{
              padding: '16px 32px', borderRadius: 60, textDecoration: 'none',
              border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)',
              color: '#fff', fontWeight: 700, fontSize: 15,
            }}>
              {ABOUT.hero.actions.secondary.label}
            </Link>
          </div>

          <div data-hero style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 52 }}>
            {ABOUT.hero.quickFacts.map((fact) => (
              <div key={fact.label} style={{
                flex: '1 1 160px', padding: '18px 20px', textAlign: 'center', borderRadius: theme.radius.lg,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1.15 }}>{fact.value}</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{fact.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section data-reveal style={{ padding: '96px 24px 60px', maxWidth: 700, margin: '0 auto' }}>
        <Eyebrow>{ABOUT.whyWeExist.eyebrow}</Eyebrow>
        <h2 style={{
          fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: TYPE.displayL,
          letterSpacing: '-0.02em', color: textDark, margin: '0 0 22px',
        }}>
          {ABOUT.whyWeExist.title}
        </h2>
        <ProseParagraph lead>{ABOUT.whyWeExist.lead}</ProseParagraph>
        {ABOUT.whyWeExist.paragraphs.map((para) => (
          <ProseParagraph key={para.slice(0, 40)}>{para}</ProseParagraph>
        ))}
        <ProseParagraph>
          {ABOUT.whyWeExist.closing.text}
          <strong style={{ color: textDark }}>{ABOUT.whyWeExist.closing.emphasis}</strong>
        </ProseParagraph>
      </section>

      <section id="mission" style={{ padding: '80px 24px 90px', maxWidth: 1000, margin: '0 auto' }}>
        <SectionHeading {...ABOUT.missionVision.heading} />
        <div data-reveal style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18 }}>
          <div style={cardSurface}>
            <IconTile name={ABOUT.missionVision.mission.icon} />
            <h3 style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 18, color: textDark, margin: '0 0 10px' }}>
              {ABOUT.missionVision.mission.title}
            </h3>
            <p style={{ fontSize: 14, color: textMid, lineHeight: 1.7, margin: 0 }}>{ABOUT.missionVision.mission.body}</p>
          </div>
          <div style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 100%)`, borderRadius: theme.radius.xl, padding: 32 }}>
            <IconTile name={ABOUT.missionVision.vision.icon} dark />
            <h3 style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 18, color: '#fff', margin: '0 0 10px' }}>
              {ABOUT.missionVision.vision.title}
            </h3>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, margin: 0 }}>{ABOUT.missionVision.vision.body}</p>
          </div>
        </div>
        <DashedNote {...ABOUT.missionVision.goal} />
      </section>

      <section style={{ padding: '80px 24px 96px', background: cardBg }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <SectionHeading {...ABOUT.offerings.heading} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18 }}>
            {ABOUT.offerings.items.map((item) => (
              <div key={item.title} data-reveal style={{ ...cardSurface, padding: 28 }}>
                <IconTile name={item.icon} />
                <h3 style={{ fontWeight: 800, fontSize: 17, color: textDark, margin: '0 0 8px' }}>{item.title}</h3>
                <p style={{ fontSize: 13.5, color: textMid, lineHeight: 1.7, margin: 0 }}>{item.body}</p>
              </div>
            ))}
          </div>
          <DashedNote {...ABOUT.offerings.note} />
        </div>
      </section>

      <section style={{ padding: '80px 24px 96px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <SectionHeading {...ABOUT.pillars.heading} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)', gap: 14 }}>
            {ABOUT.pillars.items.map((pillar, i) => {
              const Icon = ICONS[pillar.icon]
              return (
                <div key={pillar.title} data-reveal style={{ background: bg, borderRadius: theme.radius.lg, padding: 20, border: `1px solid ${border}` }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: `${tealDeep}15`, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <Icon size={19} aria-hidden="true" />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: textLight, marginBottom: 4 }}>0{i + 1}</div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: textDark, marginBottom: 6 }}>{pillar.title}</div>
                  <div style={{ fontSize: 12.5, color: textMid, lineHeight: 1.6 }}>{pillar.desc}</div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section id="story" style={{ padding: '80px 24px 96px', background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 55%, ${tealDeep} 100%)` }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <SectionHeading dark {...ABOUT.story.heading} />
          <div style={{ marginTop: 8 }}>
            {ABOUT.story.milestones.map((m) => (
              <div key={m.year} data-reveal style={{ display: 'flex', gap: 20, padding: '10px 0 34px', position: 'relative' }}>
                <div style={{ flexShrink: 0, width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontWeight: 900, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '-0.01em' }}>
                  {m.year}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', marginBottom: 6 }}>{m.title}</div>
                  <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.75, margin: 0 }}>{m.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="team" style={{ padding: '80px 24px 96px', maxWidth: 1000, margin: '0 auto' }}>
        <SectionHeading {...ABOUT.team.heading} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 14 }}>
          {ABOUT.team.founders.map((person) => (
            <div key={person.name} data-reveal style={{ background: cardBg, borderRadius: theme.radius.lg, padding: 20, textAlign: 'center', border: `1px solid ${border}` }}>
              <div style={{
                width: 54, height: 54, borderRadius: '50%', margin: '0 auto 12px',
                background: `linear-gradient(135deg, ${tealDeep} 0%, ${navy} 100%)`,
                color: '#fff', fontWeight: 800, fontSize: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }} aria-hidden="true">{person.initials}</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: textDark, lineHeight: 1.35 }}>{person.name}</div>
              <div style={{ fontSize: 11.5, color: textLight, marginTop: 4, lineHeight: 1.4 }}>{person.role}</div>
            </div>
          ))}
        </div>
      </section>

      <CtaBand {...ABOUT.cta} />

      <SiteFooter {...ABOUT.footer} />
    </main>
  )
}
