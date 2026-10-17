import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Building2, Compass, Eye, HeartHandshake, HeartPulse, MessageCircle,
  Newspaper, Star, Target, Users,
} from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import Logo from '../social-feed/Logo.jsx'

gsap.registerPlugin(ScrollTrigger)

const { tealDeep, navy, navySoft, bg, cardBg, border, textDark, textMid, textLight } = theme

const PILLARS = [
  { icon: Compass, title: 'Discovery', desc: 'Search hospitals, pharmacies, laboratories, professionals, products and services in one place, instead of moving between separate apps.' },
  { icon: Newspaper, title: 'Information', desc: 'Healthcare news, explainers and guidance from verified professionals, published by people who work in healthcare.' },
  { icon: Star, title: 'Experience', desc: 'Reviews and reports from patients who used a product, facility or professional, so you can read how it actually went.' },
  { icon: HeartHandshake, title: 'Connection', desc: 'Ask a question and get an answer from a verified professional. Follow the accounts you find useful.' },
  { icon: Building2, title: 'Business', desc: 'Listings, storefronts, stock and sales tools for pharmacies, hospitals and other healthcare businesses.' },
]

const OFFERINGS = [
  { icon: Star, title: 'Reviews that reflect real visits', body: 'People write about the product, facility, professional or service they actually used. Over time those reviews build up around each option, so you can see how it has worked for others before you choose.' },
  { icon: MessageCircle, title: 'A place to ask questions', body: 'Not every healthcare question needs a search result. CareFind also works as a social platform, where patients post questions and verified professionals answer them in public, so the next person with the same question finds the answer too.' },
  { icon: Newspaper, title: 'Healthcare news and explainers', body: 'A separate section for healthcare news and health information. We publish what is useful to a Nigerian reader and leave out what is only there to fill a feed.' },
  { icon: Users, title: 'A presence for healthcare providers', body: 'Doctors, pharmacists, nurses, hospitals, laboratories, wellness providers and healthcare businesses can set up a verified profile and reach the people who need them.' },
]

const MILESTONES = [
  {
    year: '2020',
    title: 'The WhatsApp group',
    body: 'During the COVID-19 pandemic, Pharmacist Haruna Abdullahi Tama started a WhatsApp group with Pharmacist Maryam Abdul Aziz, Pharmacist John Joseph and Rahanat Yusuf to answer people who had healthcare questions and nowhere else to go. The group grew past 500 members, mostly doctors, pharmacists, nurses, medical laboratory scientists and university lecturers, who gave their time freely and ran webinars.',
  },
  {
    year: '2024',
    title: 'HATMA Brandtech Limited',
    body: 'A WhatsApp group cannot run a pharmacy or manage stock. Haruna Abdullahi Tama founded HATMA Brandtech to build software that could. The team drew on its own experience in hospitals, community pharmacy, skincare and pharmaceutical marketing.',
  },
  {
    year: '2026',
    title: 'CareFind arrives',
    body: 'CareFind is the result. It is the same group of pharmacists, doctors and engineers, with the questions and the services now on one platform.',
  },
]

const FOUNDERS = [
  { initials: 'HT', name: 'Haruna Abdullahi Tama', role: 'Founder, HATMA Brandtech' },
  { initials: 'JJ', name: 'Pharmacist John Joseph', role: 'Chief Technology Officer' },
  { initials: 'MA', name: 'Maryam Abdul Aziz', role: 'HATMA Brandtech team' },
  { initials: 'UA', name: 'Unaisa Abdullahi', role: 'HATMA Brandtech team' },
  { initials: 'BZ', name: 'Bolu Zulaikha', role: 'HATMA Brandtech team' },
]

function Eyebrow({ children, dark = false }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: dark ? 'rgba(255,255,255,0.6)' : tealDeep,
      marginBottom: 12,
    }}>
      {children}
    </div>
  )
}

function SectionHead({ eyebrow, title, intro, dark = false }) {
  return (
    <div data-reveal style={{ maxWidth: 640, margin: '0 auto 44px', textAlign: 'center' }}>
      <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
      <h2 style={{
        fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)',
        lineHeight: 1.15, letterSpacing: '-0.02em',
        color: dark ? '#fff' : textDark, margin: '0 0 14px',
      }}>
        {title}
      </h2>
      {intro && (
        <p style={{ fontSize: 15, color: dark ? 'rgba(255,255,255,0.8)' : textMid, lineHeight: 1.7, margin: 0 }}>
          {intro}
        </p>
      )}
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

export default function About() {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const pageRef = useRef(null)
  const navRef = useRef(null)
  const heroRef = useRef(null)
  const storyRef = useRef(null)
  const [navScrolled, setNavScrolled] = useState(false)

  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const ctx = gsap.context(() => {
      if (reduceMotion) return

      /* Nav entrance */
      gsap.from(navRef.current, { y: -20, opacity: 0, duration: 0.8, ease: 'power3.out' })

      /* Hero entrance */
      gsap.from(heroRef.current?.querySelectorAll('[data-hero]'), {
        y: 40, opacity: 0, duration: 1, stagger: 0.16, ease: 'power3.out',
      })
      gsap.from(heroRef.current?.querySelector('[data-hero-media]'), {
        scale: 1.12, opacity: 0, duration: 1.4, ease: 'power2.out',
      })

      /* Per-block scroll reveals */
      gsap.utils.toArray('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          y: 30, opacity: 0, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%' },
        })
      })

      /* Nav glass-to-solid on scroll */
      ScrollTrigger.create({
        trigger: document.body, start: 'top -80',
        onToggle: ({ isActive }) => {
          setNavScrolled(isActive)
          gsap.to(navRef.current, {
            background: isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
            backdropFilter: isActive ? 'blur(16px)' : 'blur(0px)',
            duration: 0.3,
          })
        },
      })
    }, pageRef)

    return () => ctx.revert()
  }, [])

  const scrollToAnchor = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const navLinkStyle = {
    padding: '6px 12px', fontSize: 13, fontWeight: 600,
    background: 'none', border: 'none', cursor: 'pointer',
    color: navScrolled ? navy : '#fff', opacity: 0.85, fontFamily: 'inherit',
  }

  return (
    <main ref={pageRef} style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, color: textDark, overflowX: 'hidden' }}>
      {/* ── Glass nav ─────────────────────────────────────────────── */}
      <nav ref={navRef} style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(0px)',
        borderRadius: 60, padding: '8px 12px 8px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
        border: '1px solid rgba(255,255,255,0.15)',
        transition: 'background 0.3s ease',
      }}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          <Logo size={24} tone={isMobile || navScrolled ? 'dark' : 'light'} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {!isMobile && (
            <>
              <button onClick={() => scrollToAnchor('mission')} className="nav-link" style={navLinkStyle}>Mission</button>
              <button onClick={() => scrollToAnchor('story')} className="nav-link" style={navLinkStyle}>Story</button>
              <button onClick={() => scrollToAnchor('team')} className="nav-link" style={navLinkStyle}>Team</button>
            </>
          )}
          <button onClick={() => navigate('/login')} className="nav-signin" style={{
            padding: '8px 16px', borderRadius: 40,
            border: `1px solid ${navScrolled ? border : 'rgba(255,255,255,0.3)'}`,
            background: 'transparent', color: navScrolled ? navy : '#fff',
            fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Sign in
          </button>
          <button onClick={() => navigate('/search')} style={{
            padding: '8px 18px', borderRadius: 40, border: 'none',
            background: '#fff', color: navy, fontWeight: 700, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Create an account
          </button>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div ref={heroRef} style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div data-hero-media style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'url(https://images.unsplash.com/photo-1551076805-e1869033e561?w=1920&q=80&auto=format&fit=crop)',
          backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'grayscale(0.2) saturate(0.9) contrast(1.1)',
        }} />
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, rgba(11,74,62,0.3) 0%, rgba(11,74,62,0.75) 60%, ${navy} 100%)` }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '120px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
          <div data-hero style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 40,
            border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)',
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)', marginBottom: 18,
          }}>
            <HeartPulse size={14} aria-hidden="true" />
A healthcare social platform by HATMA Brandtech Limited
          </div>
          <h1 data-hero style={{
            fontFamily: theme.fontDisplay, fontWeight: 900,
            fontSize: 'clamp(2.6rem, 5.5vw, 4.6rem)', lineHeight: 1.1, letterSpacing: '-0.03em',
            color: '#fff', margin: '0 0 18px',
          }}>
            Connecting people to better healthcare.
          </h1>
          <p data-hero style={{
            fontSize: 17, color: 'rgba(255,255,255,0.78)', maxWidth: 620,
            margin: '0 auto 36px', lineHeight: 1.8,
          }}>
            CareFind was created with a simple but important realization: the healthcare system shouldn&rsquo;t be this hard to navigate. Knowing what is available, where to find it, who to trust and how to connect with it should not require a search for a platform.
          </p>
          <div data-hero style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => scrollToAnchor('story')} style={{
              padding: '16px 32px', borderRadius: 60, border: 'none', background: '#fff',
              color: navy, fontWeight: 800, fontSize: 15, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
            }}>
              Read our story <ArrowRight size={18} />
            </button>
            <button onClick={() => navigate('/search')} style={{
              padding: '16px 32px', borderRadius: 60,
              border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)',
              color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Explore care near you
            </button>
          </div>

          {/* Quick facts */}
          <div data-hero style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 52 }}>
            {[
              { value: '2020', label: 'Where it began' },
              { value: '500+', label: 'Community members' },
              { value: '2024', label: 'Company founded' },
              { value: '1', label: 'One connected ecosystem' },
            ].map((fact) => (
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
      </div>

      {/* ── Why we exist ─────────────────────────────────────────── */}
      <div data-reveal style={{ padding: '96px 24px 60px', maxWidth: 700, margin: '0 auto' }}>
        <Eyebrow>Why CareFind exists</Eyebrow>
        <h2 style={{
          fontFamily: theme.fontDisplay, fontWeight: 900,
          fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', letterSpacing: '-0.02em',
          color: textDark, margin: '0 0 22px',
        }}>
          Finding healthcare should not be difficult.
        </h2>
        <ProseParagraph lead>
          Finding the right healthcare product, service, professional or facility is harder than it should be. In Nigeria it usually means asking around, trying a number, and hoping for the best.
        </ProseParagraph>
        <ProseParagraph>
          Whether you need a hospital, pharmacy, laboratory, diagnostic centre, medical professional, skincare or cosmetic provider, a healthcare product or a wellness service, the questions are the same. What is available, where it is, and whether you can trust it.
        </ProseParagraph>
        <ProseParagraph>
          Healthcare professionals and businesses have the opposite problem. Good expertise, good products and good services often exist in a community, and the people who need them never hear about it.
        </ProseParagraph>
        <ProseParagraph>
          CareFind exists to close that gap. Our purpose is one simple idea: <strong style={{ color: textDark }}>connecting people to better healthcare.</strong>
        </ProseParagraph>
      </div>

      {/* ── Mission & vision ─────────────────────────────────────── */}
      <div id="mission" data-reveal style={{ padding: '80px 24px 30px', maxWidth: 1000, margin: '0 auto' }}>
        <SectionHead
          eyebrow="Mission & vision"
          title="CareFind was created for one reason"
          intro="To make it simple for patients, professionals and businesses to find and connect with the right healthcare."
        />
      </div>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 90px' }}>
        <div data-reveal style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18 }}>
          <div style={{ background: bg, borderRadius: theme.radius.xl, padding: 32, border: `1px solid ${border}` }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: `${tealDeep}15`, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Target size={22} aria-hidden="true" />
            </div>
            <h3 style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 18, color: textDark, margin: '0 0 10px' }}>Our mission</h3>
            <p style={{ fontSize: 14, color: textMid, lineHeight: 1.7, margin: 0 }}>
              To connect every person to healthcare they can trust. We make it simple to find the right product, service, professional or information, wherever you are, and we give healthcare professionals and businesses the visibility and tools to serve their communities properly.
            </p>
          </div>
          <div style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 100%)`, borderRadius: theme.radius.xl, padding: 32 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.12)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Eye size={22} aria-hidden="true" />
            </div>
            <h3 style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 18, color: '#fff', margin: '0 0 10px' }}>Our vision</h3>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, margin: 0 }}>
              A Nigeria where finding the right care is as easy as asking a question, where trust comes from real experience rather than guesswork, and where every healthcare professional and business is as easy to find as the people looking for them.
            </p>
          </div>
        </div>
        <div data-reveal style={{
          marginTop: 18, padding: 24, borderRadius: theme.radius.lg,
          border: `1px dashed ${border}`, textAlign: 'center',
        }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.8, margin: 0, color: textMid }}>
            <strong style={{ color: tealDeep, fontWeight: 800 }}>Our goal: </strong>
            to become the first place a Nigerian checks when they need a pharmacy, a doctor, a laboratory or an answer to a health question.
          </p>
        </div>
      </div>

      {/* ── What CareFind does ───────────────────────────────────── */}
      <div style={{ padding: '80px 24px 96px', background: cardBg }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <SectionHead
            eyebrow="What CareFind does"
            title="Find care, ask questions, and follow the people who answer"
            intro="CareFind covers discovery, health information, patient experience and the tools healthcare businesses need to run."
          />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18 }}>
            {OFFERINGS.map((f) => (
              <div key={f.title} data-reveal style={{ background: bg, borderRadius: theme.radius.xl, padding: 28, border: `1px solid ${border}` }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: `${tealDeep}15`, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <f.icon size={22} aria-hidden="true" />
                </div>
                <h3 style={{ fontWeight: 800, fontSize: 17, color: textDark, margin: '0 0 8px' }}>{f.title}</h3>
                <p style={{ fontSize: 13.5, color: textMid, lineHeight: 1.7, margin: 0 }}>{f.body}</p>
              </div>
            ))}
          </div>
          <div data-reveal style={{
            marginTop: 18, padding: 24, borderRadius: theme.radius.lg,
            border: `1px dashed ${border}`, textAlign: 'center',
          }}>
            <p style={{ fontSize: 14.5, color: textMid, lineHeight: 1.8, margin: 0 }}>
              <strong style={{ color: tealDeep, fontWeight: 800 }}>Running the business. </strong>
              A pharmacy or healthcare business can hold thousands of products and still need to track stock, record sales and handle the day to day. CareHub handles that side. CareFind handles the customer facing side, so the same business can sell through CareFind and keep its books in CareHub.
            </p>
          </div>
        </div>
      </div>

      {/* ── Why we believe this matters ──────────────────────────── */}
      <div data-reveal style={{ padding: '80px 24px 96px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <SectionHead
            eyebrow="Why we believe this matters"
            title="Healthcare is fragmented. It doesn't have to be."
            intro="People often need one platform for a hospital, another for a pharmacy, another for a professional, another for information and another for business. CareFind is built around a different approach."
          />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)', gap: 14 }}>
            {PILLARS.map((pillar, i) => (
              <div key={pillar.title} data-reveal style={{ background: bg, borderRadius: theme.radius.lg, padding: 20, border: `1px solid ${border}` }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: `${tealDeep}15`, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  <pillar.icon size={19} aria-hidden="true" />
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: textLight, marginBottom: 4 }}>0{i + 1}</div>
                <div style={{ fontWeight: 800, fontSize: 15, color: textDark, marginBottom: 6 }}>{pillar.title}</div>
                <div style={{ fontSize: 12.5, color: textMid, lineHeight: 1.6 }}>{pillar.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Our story ────────────────────────────────────────────── */}
      <section ref={storyRef} id="story" style={{ padding: '80px 24px 96px', background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 55%, ${tealDeep} 100%)` }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <SectionHead
            dark
            eyebrow="Our story"
            title="Where it all began: 2020, in the middle of a pandemic"
            intro="Movement was limited, cities went quiet, and people were told to stay indoors. But illness does not pause for a pandemic."
          />
          <div style={{ marginTop: 8 }}>
            {MILESTONES.map((m) => (
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

      {/* ── The company behind CareFind ──────────────────────────── */}
      <section id="team" data-reveal style={{ padding: '80px 24px 96px', maxWidth: 1000, margin: '0 auto' }}>
        <SectionHead
          eyebrow="The company"
          title="HATMA Brandtech and the people behind CareFind"
          intro="CareFind is a product of HATMA Brandtech Limited, founded by Haruna Abdullahi Tama in 2024, alongside a team of professionals united by a belief that technology should be used to solve meaningful, real-world problems."
        />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 14 }}>
          {FOUNDERS.map((person) => (
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

      {/* ── Where we are going / CTA ─────────────────────────────── */}
      <section data-reveal style={{ background: `linear-gradient(135deg, ${navy} 0%, ${tealDeep} 100%)`, padding: '80px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 40,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)', marginBottom: 18,
          }}>
            <Target size={14} aria-hidden="true" /> Where we are going
          </div>
          <h2 style={{
            fontFamily: theme.fontDisplay, fontWeight: 900,
            fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', letterSpacing: '-0.02em',
            color: '#fff', margin: '0 0 14px', lineHeight: 1.15,
          }}>
            Our story is just beginning.
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.82)', lineHeight: 1.8, margin: '0 0 30px' }}>
            Healthcare should be easier to discover, people should have access to information and experiences that help them make informed choices, and the professionals and businesses behind healthcare should have better ways to connect with the communities they serve. CareFind brings these ambitions together under one platform and one purpose: connecting people to better healthcare.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/search')} style={{
              padding: '16px 34px', borderRadius: 60, border: 'none', background: '#fff',
              color: navy, fontWeight: 800, fontSize: 15, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
            }}>
              Start searching <ArrowRight size={18} />
            </button>
            <button onClick={() => navigate('/feed')} style={{
              padding: '16px 34px', borderRadius: 60,
              border: '1px solid rgba(255,255,255,0.3)', background: 'transparent',
              color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Browse the feed
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: textLight }}>
          <Logo size={18} tone="dark" markOnly />
          &copy; 2026 CareFind &middot; A healthcare social platform by HATMA Brandtech Limited
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link to="/" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>Home</Link>
          <Link to="/about" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>About</Link>
          <Link to="/claim-business" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>For businesses</Link>
        </div>
      </footer>
    </main>
  )
}