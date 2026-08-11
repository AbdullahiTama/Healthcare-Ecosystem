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
  { icon: Compass, title: 'Discovery', desc: 'Hospitals, pharmacies, laboratories, professionals, products and services — without navigating a maze of disconnected platforms.' },
  { icon: Newspaper, title: 'Information', desc: 'Healthcare news, education and credible voices — so useful information is easier to find than noise.' },
  { icon: Star, title: 'Experience', desc: 'Real experiences shared by real users, giving future patients real-world context before they choose.' },
  { icon: HeartHandshake, title: 'Connection', desc: 'People with questions, professionals with knowledge, organizations with services — brought closer together.' },
  { icon: Building2, title: 'Business', desc: 'Smart business tools, so healthcare businesses can operate well and serve the communities around them.' },
]

const OFFERINGS = [
  { icon: Star, title: 'Better-informed choices', body: 'Users share their experiences with products, facilities, professionals and services. Over time those experiences gather around each option, giving future patients a broader, real-world picture to consider. Transparency, layered on top of discovery.' },
  { icon: MessageCircle, title: 'More than a search', body: 'CareFind is a healthcare social platform, not simply a directory. People have questions, professionals have knowledge, organizations have services — all brought into one healthcare-focused social environment.' },
  { icon: Newspaper, title: 'Reliable healthcare information', body: 'A dedicated space for healthcare news and information, plus opportunities to learn from credible voices — helping useful information become easier to discover, not adding to the noise.' },
  { icon: Users, title: 'Empowering people behind healthcare', body: 'Doctors, pharmacists, nurses, hospitals, laboratories, wellness providers and healthcare businesses gain a digital presence where their expertise and services can reach the people who need them.' },
]

const MILESTONES = [
  {
    year: '2020',
    title: 'The WhatsApp group',
    body: 'In Nigeria, in the middle of the COVID-19 pandemic, Pharmacist Haruna Abdullahi Tama created a WhatsApp group alongside Pharmacist Maryam Abdul Aziz, Pharmacist John Joseph and Rahanat Yusuf — dedicated to answering people\u2019s healthcare questions when they had nowhere else to turn. It grew to over 500 members: doctors, pharmacists, nurses, medical laboratory scientists and university lecturers, giving their time and knowledge freely, hosting webinars and bringing clarity to a moment full of uncertainty.',
  },
  {
    year: '2024',
    title: 'HATMA Brandtech Limited',
    body: 'Goodwill alone could not scale. Haruna Abdullahi Tama founded HATMA Brandtech, beginning a journey into building real, lasting solutions. A team came together to learn, build and refine what would become CareFind — shaped by experience on the frontlines of hospital, community pharmacy, skincare and pharmaceutical marketing work.',
  },
  {
    year: '2026',
    title: 'CareFind arrives',
    body: 'Now, in 2026, that journey arrives at CareFind: the solution a small WhatsApp group in the middle of a pandemic first set out, in its own way, to build.',
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
            Get started
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
          Healthcare is one of the most essential parts of human life. Yet accessing the right healthcare product, service, professional, facility, information or support can be extremely difficult.
        </ProseParagraph>
        <ProseParagraph>
          Whether someone is looking for a hospital, pharmacy, laboratory, diagnostic centre, medical professional, skincare and cosmetic provider, healthcare product, wellness service or another healthcare resource, the challenge is often the same: knowing what is available, where to find it, who to trust, and how to connect with it.
        </ProseParagraph>
        <ProseParagraph>
          For healthcare professionals, businesses and organizations, the challenge is just as significant — valuable expertise, products and services may exist within a community without ever being discoverable by the people who need them.
        </ProseParagraph>
        <ProseParagraph>
          This is the gap CareFind was created to help bridge. Our purpose is one simple idea: <strong style={{ color: textDark }}>connecting people to better healthcare.</strong>
        </ProseParagraph>
      </div>

      {/* ── Mission & vision ─────────────────────────────────────── */}
      <div id="mission" data-reveal style={{ padding: '80px 24px 30px', maxWidth: 1000, margin: '0 auto' }}>
        <SectionHead
          eyebrow="Mission & vision"
          title="CareFind was created for one reason"
          intro="To make it simple for everyone — patients, professionals, businesses — to find, understand and connect with the right healthcare."
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
              To connect every person to healthcare they can trust — making it simple to discover the right product, service, professional or information, wherever they are, and to give healthcare professionals and businesses the visibility and tools they need to serve their communities well.
            </p>
          </div>
          <div style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 100%)`, borderRadius: theme.radius.xl, padding: 32 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.12)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Eye size={22} aria-hidden="true" />
            </div>
            <h3 style={{ fontFamily: theme.fontDisplay, fontWeight: 800, fontSize: 18, color: '#fff', margin: '0 0 10px' }}>Our vision</h3>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, margin: 0 }}>
              A future where healthcare is never out of reach — where finding the right care is as simple as asking a question, where trust is built on real experience rather than guesswork, and where every healthcare professional, business and organization is as discoverable as the people who need them.
            </p>
          </div>
        </div>
        <div data-reveal style={{
          marginTop: 18, padding: 24, borderRadius: theme.radius.lg,
          border: `1px dashed ${border}`, textAlign: 'center',
        }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.8, margin: 0, color: textMid }}>
            <strong style={{ color: tealDeep, fontWeight: 800 }}>Our goal: </strong>
            to grow CareFind into one of the most trusted and reputable healthcare platforms in the world — not the biggest for its own sake, but the one people turn to first, wherever in the world they are standing.
          </p>
        </div>
      </div>

      {/* ── What CareFind does ───────────────────────────────────── */}
      <div style={{ padding: '80px 24px 96px', background: cardBg }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <SectionHead
            eyebrow="What CareFind does"
            title="A healthcare social platform, not just a directory"
            intro="CareFind brings discovery, information, experience, connection and business together around the people who need them."
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
              <strong style={{ color: tealDeep, fontWeight: 800 }}>Smart business management. </strong>
              Beyond visibility, CareFind incorporates smart business and inventory management software — because a pharmacy or healthcare business may manage hundreds or thousands of products while dealing with stock, sales and day-to-day operations. CareFind doesn't only help people find healthcare; it helps healthcare businesses operate, connect and serve more effectively.
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