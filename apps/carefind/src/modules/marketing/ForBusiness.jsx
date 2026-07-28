import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ChevronRight, Heart, MessageCircle, Search, Shield, Star, Users } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import Logo from '../social-feed/Logo.jsx'

gsap.registerPlugin(ScrollTrigger)

const { tealDeep, tealBright, navy, navySoft, bg, cardBg, border, textDark, textMid, textLight } = theme

const FEATURES = [
  { icon: Search, title: 'Find care near you', desc: 'Search medicines, pharmacies, hospitals and labs in your area. Real listings, real locations.', color: '#0E6F5A' },
  { icon: Star, title: 'Real patient reviews', desc: 'See what actual patients say before you book. Every review comes from a verified visit.', color: '#1A8A72' },
  { icon: MessageCircle, title: 'Connect on WhatsApp', desc: 'Message providers directly. No extra app, no phone tag, just tap and talk.', color: '#155A4B' },
  { icon: Shield, title: 'Verified providers', desc: 'Every business on CareFind is verified. Your health deserves nothing less.', color: '#0B4A3E' },
]

const STEPS = [
  { title: 'Search', desc: 'Find the medicine, pharmacy, hospital or lab you need near you. Browse verified listings with detailed profiles.', image: 'https://images.unsplash.com/photo-1581056771107-24ca5f033842?w=800&q=80&auto=format&fit=crop' },
  { title: 'Compare', desc: 'Read reviews from real patients, check ratings, and compare options side by side before making a decision.', image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=80&auto=format&fit=crop' },
  { title: 'Connect', desc: 'Message the provider on WhatsApp or visit them in person. Same-day care is just a few taps away.', image: 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&q=80&auto=format&fit=crop' },
]

const TESTIMONIALS = [
  { quote: 'I found a pharmacy that had my medication in stock within minutes. This app saved me hours of calling around.', name: 'Sarah K.', role: 'Patient', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80&auto=format&fit=crop' },
  { quote: 'Being able to see real reviews from verified patients made choosing a doctor so much easier. I finally trust my healthcare decisions.', name: 'James M.', role: 'Patient', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80&auto=format&fit=crop' },
  { quote: 'The WhatsApp connection feature is brilliant. I messaged a clinic directly and had an appointment scheduled in under a minute.', name: 'Amara O.', role: 'Patient', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80&auto=format&fit=crop' },
]

const PARTNERS = ['Lagos State Hospital', 'MedPlus Pharmacy', 'Reddington Hospital', 'HealthPlus', 'ecare Africa', 'ClinicPlus']

function FeatureCard({ icon: Icon, title, desc, color, index }) {
  return (
    <div className="feature-card" data-index={index} style={{
      background: cardBg, borderRadius: theme.radius.xl, padding: 28, border: `1px solid ${border}`,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 16 }}>
        <Icon size={22} aria-hidden="true" />
      </div>
      <div style={{ fontWeight: 800, fontSize: 15, color: textDark, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: textMid, lineHeight: 1.65, flex: 1 }}>{desc}</div>
    </div>
  )
}

function StepPanel({ step, index, active, onHover }) {
  return (
    <div
      className="step-panel"
      data-index={index}
      onMouseEnter={() => onHover(index)}
      style={{
        flex: active ? 3 : 1, minWidth: 0,
        borderRadius: theme.radius.xl, overflow: 'hidden',
        background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 100%)`,
        cursor: 'pointer', transition: 'flex 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        position: 'relative', display: 'flex', alignItems: 'flex-end',
        minHeight: 320,
      }}
    >
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.3,
        backgroundImage: `url(${step.image})`, backgroundSize: 'cover', backgroundPosition: 'center',
      }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(11,74,62,0.95) 0%, rgba(11,74,62,0.3) 60%, rgba(11,74,62,0.1) 100%)' }} />
      <div style={{ position: 'relative', zIndex: 1, padding: 24, width: '100%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 11, fontWeight: 800, marginBottom: 10 }}>{index + 1}</div>
        <div style={{ fontWeight: 800, fontSize: active ? 18 : 15, color: '#fff', marginBottom: active ? 8 : 0, transition: 'all 0.4s ease' }}>{step.title}</div>
        {active && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, maxWidth: 360 }}>{step.desc}</div>}
      </div>
    </div>
  )
}

export default function ForBusiness() {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const sectionRef = useRef(null)
  const heroRef = useRef(null)
  const featuresRef = useRef(null)
  const stepsRef = useRef(null)
  const marqueeRef = useRef(null)
  const testimonialsRef = useRef(null)
  const ctaRef = useRef(null)
  const [activeStep, setActiveStep] = useState(0)
  const [testimonialIndex, setTestimonialIndex] = useState(0)

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Hero entrance
      gsap.from(heroRef.current?.querySelectorAll('.hero-fade'), {
        y: 60, opacity: 0, duration: 1, stagger: 0.2, ease: 'power3.out',
      })
      gsap.from(heroRef.current?.querySelector('.hero-image'), {
        scale: 1.15, opacity: 0, duration: 1.4, ease: 'power2.out',
      })

      // Features scroll entrance
      gsap.from(featuresRef.current?.querySelectorAll('.feature-card'), {
        scrollTrigger: { trigger: featuresRef.current, start: 'top 85%' },
        y: 50, opacity: 0, duration: 0.8, stagger: 0.15, ease: 'power3.out',
      })

      // Steps scroll entrance
      gsap.from(stepsRef.current?.querySelectorAll('.step-panel'), {
        scrollTrigger: { trigger: stepsRef.current, start: 'top 80%' },
        y: 40, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power2.out',
      })

      // Testimonials
      gsap.from(testimonialsRef.current?.querySelector('.testimonial-card'), {
        scrollTrigger: { trigger: testimonialsRef.current, start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.8, ease: 'power2.out',
      })

      // CTA
      gsap.from(ctaRef.current?.querySelectorAll('.cta-fade'), {
        scrollTrigger: { trigger: ctaRef.current, start: 'top 90%' },
        y: 40, opacity: 0, duration: 0.7, stagger: 0.15, ease: 'power3.out',
      })

      // Nav glass to solid on scroll
      ScrollTrigger.create({
        trigger: document.body, start: 'top -80',
        onToggle: ({ isActive }) => {
          gsap.to('.landing-nav', {
            background: isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
            backdropFilter: isActive ? 'blur(16px)' : 'blur(0px)',
            borderBottom: isActive ? `1px solid ${border}` : '1px solid transparent',
            duration: 0.3,
          })
          gsap.to('.nav-link', {
            color: isActive ? navy : '#fff',
            duration: 0.3,
          })
          gsap.to('.nav-signin', {
            color: isActive ? navy : '#fff',
            borderColor: isActive ? border : 'rgba(255,255,255,0.3)',
            duration: 0.3,
          })
        },
      })

      // Image scale on scroll for step panels
      gsap.to(stepsRef.current?.querySelectorAll('.step-panel img'), {
        scrollTrigger: { trigger: stepsRef.current, start: 'top bottom', end: 'bottom top', scrub: 0.5 },
        scale: 0.95, opacity: 0.6,
      })
    }, sectionRef)

    return () => ctx.revert()
  }, [])

  // Auto-rotate testimonials
  useEffect(() => {
    if (!testimonialsRef.current) return
    const t = setInterval(() => setTestimonialIndex(i => (i + 1) % TESTIMONIALS.length), 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <main ref={sectionRef} style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, color: textDark, overflowX: 'hidden', width: '100%', maxWidth: '100%' }}>
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-track { animation: marquee 30s linear infinite; }
        .marquee-track:hover { animation-play-state: paused; }
      `}</style>

      {/* ── Glass Nav ─────────────────────────────────────────── */}
      <nav className="landing-nav" style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(0px)',
        borderRadius: 60, padding: '8px 10px 8px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
        border: '1px solid rgba(255,255,255,0.15)',
        transition: 'background 0.3s ease',
      }}>
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          <Logo size={24} tone={isMobile ? 'dark' : 'light'} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isMobile && (
            <>
              <a href="#features" className="nav-link hero-fade" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none', opacity: 0.85, transition: 'opacity 0.2s' }}
                onMouseEnter={e => e.target.style.opacity = '1'} onMouseLeave={e => e.target.style.opacity = '0.85'}>Features</a>
              <a href="#how-it-works" className="nav-link hero-fade" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none', opacity: 0.85, transition: 'opacity 0.2s' }}
                onMouseEnter={e => e.target.style.opacity = '1'} onMouseLeave={e => e.target.style.opacity = '0.85'}>How it works</a>
            </>
          )}
          <button onClick={() => navigate('/login')} className="nav-signin hero-fade" style={{ padding: '8px 16px', borderRadius: 40, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Sign in
          </button>
          <button onClick={() => navigate('/search')} className="hero-fade" style={{ padding: '8px 18px', borderRadius: 40, border: 'none', background: '#fff', color: navy, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Get started
          </button>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div ref={heroRef} style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div className="hero-image" style={{ position: 'absolute', inset: 0, backgroundImage: 'url(https://images.unsplash.com/photo-1551076805-e1869033e561?w=1920&q=80&auto=format&fit=crop)', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'grayscale(0.2) saturate(0.9) contrast(1.1)', transform: 'scale(1.05)' }} />
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, rgba(11,74,62,0.3) 0%, rgba(11,74,62,0.75) 60%, ${navy} 100%)` }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '120px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
          <h1 className="hero-fade" style={{ fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: 'clamp(2.8rem, 6vw, 5rem)', lineHeight: 1.08, letterSpacing: '-0.03em', color: '#fff', margin: '0 0 10px' }}>
            Find the care you{' '}
            <span style={{ display: 'inline-block', width: 64, height: 48, borderRadius: 24, verticalAlign: 'middle', margin: '0 4px', backgroundImage: 'url(https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=200&q=80&auto=format&fit=crop)', backgroundSize: 'cover', backgroundPosition: 'center', border: '2px solid rgba(255,255,255,0.3)', filter: 'saturate(0.85) contrast(1.15)' }} />
            {' '}need, right where you are.
          </h1>
          <p className="hero-fade" style={{ fontSize: 17, color: 'rgba(255,255,255,0.75)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.7, fontWeight: 400 }}>
            Search medicines, compare pharmacies, read real reviews, and connect with healthcare providers near you — all in one place.
          </p>
          <div className="hero-fade" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => navigate('/search')} style={{ padding: '16px 32px', borderRadius: 60, border: 'none', background: '#fff', color: navy, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
              onMouseEnter={e => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 12px 32px rgba(0,0,0,0.2)' }}
              onMouseLeave={e => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none' }}>
              Start searching <ArrowRight size={18} />
            </button>
            <button onClick={() => navigate('/feed')} style={{ padding: '16px 32px', borderRadius: 60, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', transition: 'background 0.2s ease' }}
              onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.15)'} onMouseLeave={e => e.target.style.background = 'rgba(255,255,255,0.08)'}>
              Browse feed
            </button>
          </div>
        </div>
      </div>

      {/* ── Features Bento ────────────────────────────────────── */}
      <div ref={featuresRef} id="features" style={{ padding: '80px 24px 96px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', color: textDark, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Everything you need to{' '}<span style={{ color: tealDeep }}>make informed health decisions</span>.
          </h2>
          <p style={{ fontSize: 15, color: textMid, maxWidth: 540, margin: '0 auto', lineHeight: 1.6 }}>CareFind brings together every tool you need to navigate your health journey with confidence.</p>
        </div>
        <div className="bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, gridAutoFlow: 'dense' }}>
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} {...f} index={i} />
          ))}
        </div>
      </div>

      {/* ── Steps Horizontal Accordion ────────────────────────── */}
      <div ref={stepsRef} id="how-it-works" style={{ padding: '80px 24px 96px', background: cardBg }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', color: textDark, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
              Three steps to{' '}<span style={{ color: tealDeep }}>better care</span>.
            </h2>
            <p style={{ fontSize: 15, color: textMid, maxWidth: 540, margin: '0 auto', lineHeight: 1.6 }}>Getting the care you need has never been simpler.</p>
          </div>
          <div style={{ display: 'flex', gap: 12, minHeight: 360 }}>
            {isMobile ? (
              STEPS.map((s, i) => (
                <div key={s.title} style={{ flex: 1, borderRadius: theme.radius.xl, overflow: 'hidden', background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 100%)`, position: 'relative', display: 'flex', alignItems: 'flex-end', minHeight: 320 }}>
                  <div style={{ position: 'absolute', inset: 0, opacity: 0.3, backgroundImage: `url(${s.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(11,74,62,0.95) 0%, rgba(11,74,62,0.3) 60%, rgba(11,74,62,0.1) 100%)' }} />
                  <div style={{ position: 'relative', zIndex: 1, padding: 20, width: '100%' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 11, fontWeight: 800, marginBottom: 8 }}>{i + 1}</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', marginBottom: 4 }}>{s.title}</div>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
              ))
            ) : (
              STEPS.map((s, i) => (
                <StepPanel key={s.title} step={s} index={i} active={activeStep === i} onHover={setActiveStep} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Infinite Marquee (Trust Partners) ─────────────────── */}
      <div style={{ padding: '60px 0', overflow: 'hidden', background: bg }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: textLight, textAlign: 'center', marginBottom: 20 }}>Trusted by healthcare providers across the region</div>
        <div style={{ display: 'flex', overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent 0%, black 5%, black 95%, transparent 100%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
          <div className="marquee-track" style={{ display: 'flex', gap: 48, flexShrink: 0, padding: '0 24px' }}>
            {[...PARTNERS, ...PARTNERS].map((name, i) => (
              <div key={i} style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: textLight, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Testimonials ──────────────────────────────────────── */}
      <div ref={testimonialsRef} style={{ padding: '80px 24px 96px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)', color: textDark, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            What patients are saying
          </h2>
        </div>
        <div className="testimonial-card" style={{ background: cardBg, borderRadius: theme.radius.xl, padding: 40, border: `1px solid ${border}`, textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: -8, marginBottom: 20 }}>
            {TESTIMONIALS.map((t, i) => (
              <div key={i} style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid white', marginLeft: i > 0 ? -12 : 0, backgroundImage: `url(${t.avatar})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: i === testimonialIndex ? 1 : 0.4, transition: 'opacity 0.5s ease' }} />
            ))}
          </div>
          <p style={{ fontSize: 17, color: textMid, lineHeight: 1.7, margin: '0 0 20px', fontStyle: 'italic', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
            &ldquo;{TESTIMONIALS[testimonialIndex].quote}&rdquo;
          </p>
          <div style={{ fontWeight: 800, fontSize: 14, color: textDark }}>{TESTIMONIALS[testimonialIndex].name}</div>
          <div style={{ fontSize: 12, color: textLight }}>{TESTIMONIALS[testimonialIndex].role}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
            <button onClick={() => setTestimonialIndex(i => (i - 1 + TESTIMONIALS.length) % TESTIMONIALS.length)} aria-label="Previous testimonial" style={{ width: 44, height: 44, borderRadius: '50%', border: `1px solid ${border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: textMid }}>
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setTestimonialIndex(i => (i + 1) % TESTIMONIALS.length)} aria-label="Next testimonial" style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: tealDeep, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <div ref={ctaRef} style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 50%, ${tealDeep} 100%)`, padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 className="cta-fade" style={{ fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: 'clamp(1.6rem, 3vw, 2.6rem)', color: '#fff', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Ready to find the care you need?
          </h2>
          <p className="cta-fade" style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', margin: '0 0 32px', lineHeight: 1.6 }}>
            Join thousands of patients using CareFind every day. Start your health journey today.
          </p>
          <button className="cta-fade" onClick={() => navigate('/search')} style={{ padding: '16px 36px', borderRadius: 60, border: 'none', background: '#fff', color: navy, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
            onMouseEnter={e => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 16px 40px rgba(0,0,0,0.2)' }}
            onMouseLeave={e => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none' }}>
            Start searching <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────── */}
      <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: textLight }}>
          <Logo size={18} tone="dark" markOnly />
          &copy; 2026 CareFind &middot; Part of the Care ecosystem
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link to="/feed" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>Feed</Link>
          <Link to="/claim-business" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>For businesses</Link>
          <a href="#features" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>Features</a>
        </div>
      </div>
    </main>
  )
}