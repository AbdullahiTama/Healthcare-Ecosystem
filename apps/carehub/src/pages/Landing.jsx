import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Package, ShoppingCart, Users, Heart, BarChart2, Search, MapPin, Clipboard, Clock, Eye, AlertCircle, Check as CheckIcon, Wallet, WifiOff } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../styles/theme'
import { Logo } from '../components/ui'
import { BUSINESS_TYPES } from '../config/constants'
import { useBreakpoint } from '../hooks/useBreakpoint'

gsap.registerPlugin(ScrollTrigger)

const { tealDeep, tealBright, deepTeal, tealMist, fontDisplay, bg, cardBg, navy, gray600, gray500, gray400, gray300, border } = theme

const PLANS = [
  ['Basic', '60,000', '/year', ['Up to 2 locations', 'Up to 5 staff', 'Up to 5,000 products', 'All core features', 'Hospitals excluded'], false],
  ['Growth', '100,000', '/year', ['Up to 5 locations', 'Unlimited products', 'Unlimited staff', 'All core features', 'Hospitals start here'], true],
  ['Premium', '150,000', '/year', ['Up to 10 locations', 'Unlimited products', 'Unlimited staff', 'All core features', 'Premium features'], false],
  ['Enterprise', '250,000', '/year', ['Up to 30 locations', 'Unlimited products', 'Unlimited staff', 'Personalized support', 'For large orgs & importers'], false],
  ['Custom', 'Custom', '', ['Bespoke to your org', 'Tailored locations & volume', 'Personalized support', 'Contact sales'], false],
]

export default function Landing() {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const heroRef = useRef(null)
  const [navScrolled, setNavScrolled] = useState(false)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(heroRef.current?.querySelectorAll('.hero-fade'), {
        y: 50, opacity: 0, duration: 1, stagger: 0.18, ease: 'power3.out',
      })

      gsap.from('.business-type-pill', {
        scrollTrigger: { trigger: '.business-types-strip', start: 'top 90%' },
        x: -40, opacity: 0, duration: 0.6, stagger: 0.06, ease: 'power2.out',
      })

      gsap.from('.feature-card', {
        scrollTrigger: { trigger: '#features', start: 'top 82%' },
        y: 40, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power2.out',
      })

      gsap.from('.visibility-section', {
        scrollTrigger: { trigger: '.visibility-section', start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.7, ease: 'power2.out',
      })

      gsap.from('.inventory-card', {
        scrollTrigger: { trigger: '.inventory-section', start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power2.out',
      })

      gsap.from('.ai-section', {
        scrollTrigger: { trigger: '.ai-section', start: 'top 85%' },
        scale: 0.95, opacity: 0, duration: 0.8, ease: 'power2.out',
      })

      gsap.from('.ecom-step', {
        scrollTrigger: { trigger: '.ecom-section', start: 'top 85%' },
        y: 40, opacity: 0, duration: 0.6, stagger: 0.15, ease: 'power2.out',
      })

      gsap.from('.bi-card', {
        scrollTrigger: { trigger: '.bi-section', start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out',
      })

      gsap.from('.ops-card', {
        scrollTrigger: { trigger: '.ops-section', start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.6, stagger: 0.12, ease: 'power2.out',
      })

      gsap.from('.who-card', {
        scrollTrigger: { trigger: '.who-section', start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power2.out',
      })

      gsap.from('.why-item', {
        scrollTrigger: { trigger: '.why-section', start: 'top 85%' },
        y: 20, opacity: 0, duration: 0.5, stagger: 0.06, ease: 'power2.out',
      })

      gsap.from('.pricing-card', {
        scrollTrigger: { trigger: '.pricing-grid', start: 'top 82%' },
        y: 30, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out',
      })

      gsap.from('.cta-section', {
        scrollTrigger: { trigger: '.cta-section', start: 'top 85%' },
        scale: 0.95, opacity: 0, duration: 0.8, ease: 'power2.out',
      })

      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'bottom top',
        onEnter: () => setNavScrolled(true),
        onLeaveBack: () => setNavScrolled(false),
      })
    })
    return () => ctx.revert()
  }, [])

  return (
    <main style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, overflowX: 'hidden', width: '100%', maxWidth: '100%', color: navy }}>

      {/* ── Glass Nav ─────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        background: navScrolled ? '#fff' : 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(20px)',
        borderRadius: 64, padding: '8px 10px 8px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
        border: navScrolled ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.08)',
        transition: 'background 0.3s ease, border 0.3s ease, backdropFilter 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={28} />
          <span style={{ fontWeight: 900, fontSize: 16, color: navScrolled ? tealDeep : '#fff', letterSpacing: '-0.01em', transition: 'color 0.3s ease' }}>CareHub</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 20 }}>
          {!isMobile && (
            <>
              <a href="#features" style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, color: navScrolled ? tealDeep : 'rgba(255,255,255,0.8)', textDecoration: 'none', transition: 'color 0.3s ease' }}>Features</a>
              <a href="#pricing" style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, color: navScrolled ? tealDeep : 'rgba(255,255,255,0.8)', textDecoration: 'none', transition: 'color 0.3s ease' }}>Pricing</a>
            </>
          )}
          <button onClick={() => navigate('/login')} style={{ padding: '7px 14px', borderRadius: 40, border: navScrolled ? `1px solid ${tealDeep}` : '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: navScrolled ? tealDeep : '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'color 0.3s ease, border 0.3s ease' }}>Sign in</button>
          <button onClick={() => navigate('/register')} style={{ padding: '7px 16px', borderRadius: 40, border: 'none', background: '#fff', color: deepTeal, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Start free trial</button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div ref={heroRef} style={{
        minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${deepTeal}E6 0%, ${tealDeep}D9 50%, #0D5F4DE6 100%)`,
        position: 'relative', overflow: 'hidden', padding: isMobile ? '120px 20px 80px' : '140px 24px 100px',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.06) 0%, transparent 55%)',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 900, margin: '0 auto' }}>
          <div className="hero-fade" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 16, backdropFilter: 'blur(6px)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.6)' }} /> 30-day free trial · No complicated setup
          </div>
          <h1 className="hero-fade" style={{
            fontFamily: fontDisplay, fontWeight: 700,
            fontSize: isMobile ? 'clamp(32px, 8vw, 42px)' : 'clamp(42px, 5vw, 60px)',
            lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', margin: '0 0 16px',
            maxWidth: 900, textWrap: 'balance',
          }}>
            Run Your Healthcare Business Smarter. Get Seen. Grow Faster.
          </h1>
          <p className="hero-fade" style={{ fontSize: isMobile ? 14 : 16, color: 'rgba(255,255,255,0.82)', maxWidth: 600, margin: '0 auto 12px', lineHeight: 1.7, fontWeight: 500 }}>
            The intelligent business management platform fully designed for your healthcare, wellness, beauty and personal-care business.
          </p>
          <p className="hero-fade" style={{ fontSize: isMobile ? 14 : 16, color: 'rgba(255,255,255,0.82)', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.7, fontWeight: 500 }}>
            Manage your inventory, sales, staff, clients, finances, appointments, locations and daily operations from one powerful platform, while giving your business greater visibility across the CareFind health social platform.
          </p>
          <div className="hero-fade" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/register')} style={{ padding: '14px 30px', borderRadius: theme.radius.md, border: 'none', background: '#fff', color: deepTeal, fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
              Start Your 30-Day Free Trial <ArrowRight size={16} />
            </button>
            <a href="#features" style={{ padding: '14px 30px', borderRadius: theme.radius.md, border: '1px solid rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', backdropFilter: 'blur(6px)' }}>See How CareHub Works</a>
          </div>
          <div className="hero-fade" style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24, padding: '10px 16px', borderRadius: 999, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
            {['30-day free trial', 'Works offline', 'Business-specific tools'].map(c => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.88)', fontWeight: 600 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: tealBright, flexShrink: 0, boxShadow: '0 0 6px rgba(45,212,191,0.6)' }} />
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Business Types Strip ──────────────────────────────── */}
      <div className="business-types-strip" style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: gray400, marginBottom: 16 }}>Built for your type of business</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {BUSINESS_TYPES.map(b => (
            <div key={b.id} className="business-type-pill" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 6px', borderRadius: 999, border: `1px solid ${border}`, background: 'white', fontSize: 12.5, fontWeight: 700, color: navy, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{b.icon}</span>
              {b.name}
            </div>
          ))}
        </div>
      </div>

      {/* ── Core Positioning Bento Grid ───────────────────────── */}
      <div id="features" style={{ padding: '60px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 36, color: navy, margin: '0 0 12px', lineHeight: 1.2 }}>
            Everything Your Business Needs. In One Place.
          </h2>
          <p style={{ fontSize: 14, color: gray500, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            CareHub brings the essential tools required to manage modern healthcare and related businesses into one connected platform.
          </p>
        </div>
        <div style={{ display: 'grid', gridAutoFlow: 'dense', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
          {/* Featured: Inventory Management */}
          <div className="feature-card" style={{ gridColumn: isMobile ? 'span 1' : 'span 2', gridRow: isMobile ? 'span 1' : 'span 2', background: `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)`, borderRadius: theme.radius.xl, padding: 32, display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#fff' }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Package size={22} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Inventory Management</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.65 }}>Track stock levels, cost prices, margins, reorder points and product movement across all your locations.</div>
          </div>
          {/* Sales & POS */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ShoppingCart size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Sales & Point of Sale</div></div>
          </div>
          {/* Staff Management */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Users size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Staff Management</div></div>
          </div>
          {/* Client Management */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Heart size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Client Management</div></div>
          </div>
          {/* Financial Management */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><BarChart2 size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Financial Management</div></div>
          </div>
          {/* Reporting */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Clipboard size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Reporting</div></div>
          </div>
          {/* Demand Intelligence */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Search size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Demand Intelligence</div></div>
          </div>
          {/* Appointments */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Clock size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Appointments</div></div>
          </div>
          {/* Multi-location */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MapPin size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Multi-location</div></div>
          </div>
          {/* E-commerce */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ShoppingCart size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>E-commerce</div></div>
          </div>
          {/* CareFind Visibility */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Eye size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>CareFind Visibility</div></div>
          </div>
          {/* Pharmacovigilance */}
          <div className="feature-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', alignItems: 'center', gap: 14, transition: 'transform 0.3s ease, box-shadow 0.3s ease' }} onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }} onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><AlertCircle size={20} /></div>
            <div><div style={{ fontWeight: 800, fontSize: 13, color: navy }}>Pharmacovigilance</div></div>
          </div>
        </div>
      </div>

      {/* ── Business Visibility ───────────────────────────────── */}
      <div className="visibility-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 40 : 48 }}>
          {/* Left: text */}
          <div style={{ flex: isMobile ? '1 1 100%' : '1 1 66%' }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Don't Just Manage Your Business. Get Discovered.
            </h2>
            <p style={{ fontSize: 14, color: gray500, lineHeight: 1.7, marginBottom: 20 }}>
              CareHub gives businesses greater visibility across the CareFind health social platform, helping potential customers discover the business, its services, products and relevant information.
            </p>
            {[
              'Your business appears in CareFind search results',
              'Customers discover your services, products and information',
              'Managed directly from your CareHub dashboard',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: gray600, padding: '5px 0' }}>
                <CheckIcon size={14} color={tealDeep} strokeWidth={3} />
                {item}
              </div>
            ))}
            <p style={{ fontWeight: 800, fontSize: 15, color: tealDeep, marginTop: 16 }}>
              Manage your business with CareHub. Get discovered through CareFind.
            </p>
          </div>
          {/* Right: visual */}
          <div style={{ flex: isMobile ? '1 1 100%' : '1 1 34%', width: isMobile ? '100%' : 'auto' }}>
            <div style={{ background: `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)`, borderRadius: theme.radius.xl, padding: 24, color: 'white', minHeight: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>CareFind</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Health Social Platform</div>
              {/* Abstract search results */}
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.1)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 8, width: `${60 + i * 10}%`, borderRadius: 4, background: 'rgba(255,255,255,0.3)', marginBottom: 6 }} />
                    <div style={{ height: 6, width: `${40 + i * 8}%`, borderRadius: 3, background: 'rgba(255,255,255,0.15)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Inventory & Operations ──────────────────────────────── */}
      <div className="inventory-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: `linear-gradient(180deg, ${bg} 0%, #fff 100%)` }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Know What You Have. Know What You Need.
            </h2>
            <p style={{ fontSize: 14, color: gray500, maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>
              CareHub helps businesses maintain better control over products and stock, monitor activity, identify what needs attention and make more informed purchasing and operational decisions.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { icon: Package, text: 'Track inventory and stock levels' },
              { icon: BarChart2, text: 'Monitor product movement' },
              { icon: Search, text: 'Identify products requiring attention' },
              { icon: Clipboard, text: 'Support restocking decisions' },
              { icon: MapPin, text: 'Manage inventory across locations' },
              { icon: ShoppingCart, text: 'Connect eligible products to e-commerce' },
            ].map((item, i) => (
              <div key={i} className="inventory-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <item.icon size={20} />
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, lineHeight: 1.4 }}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Intelligent Technology ─────────────────────────────── */}
      <div className="ai-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ background: `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)`, borderRadius: theme.radius.xl, padding: isMobile ? 32 : 48, textAlign: 'center', color: 'white' }}>
            <div style={{ display: 'inline-block', padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.15)', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', marginBottom: 20 }}>INTELLIGENT TECHNOLOGY</div>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 24 : 30, margin: '0 0 16px', lineHeight: 1.2 }}>
              Built With Intelligent Technology for Modern Businesses.
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)', maxWidth: 600, margin: '0 auto 20' }}>
              CareHub uses AI and intelligent technology as part of its vision for smarter business operations. The platform helps businesses turn operational information into useful insights, reduce guesswork and support better decisions.
            </p>
            <p style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>
              Less guesswork. More control. Better decisions.
            </p>
          </div>
        </div>
      </div>

      {/* ── E-Commerce ─────────────────────────────────────────── */}
      <div className="ecom-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: `linear-gradient(180deg, ${bg} 0%, #fff 100%)` }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Turn Your Inventory Into an Online Storefront.
            </h2>
            <p style={{ fontSize: 14, color: gray500, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
              Businesses can select eligible products from their inventory and make them available through the CareFind Shop.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { title: 'Select eligible products', desc: 'Choose products from your inventory that you want to sell online.' },
              { title: 'Complete product information', desc: 'Add the required product image and description for the CareFind Shop.' },
              { title: 'Activate for visibility', desc: 'Once activated, customers can discover and purchase through CareFind.' },
            ].map((step, i) => (
              <div key={i}>
                <div className="ecom-step" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: isMobile ? 20 : 24, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: theme.radius.full, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, flexShrink: 0 }}>{i + 1}</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: isMobile ? 15 : 16, color: navy, marginBottom: 4 }}>{step.title}</div>
                    <div style={{ fontSize: 13.5, color: gray500, lineHeight: 1.6 }}>{step.desc}</div>
                  </div>
                </div>
                {i < 2 && <div style={{ width: 2, height: 16, background: border, margin: '0 auto' }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Business Intelligence ──────────────────────────────── */}
      <div className="bi-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Don't Just Run Your Business. Understand It.
            </h2>
            <p style={{ fontSize: 14, color: gray500, maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>
              CareHub helps transform everyday business activity into useful information so owners and managers can better understand sales, inventory, expenses, debts, demand and financial performance.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { icon: BarChart2, title: 'Revenue', desc: 'Track sales and revenue trends' },
              { icon: Package, title: 'Inventory', desc: 'Monitor stock levels and movement' },
              { icon: Wallet, title: 'Expenses', desc: 'Track and categorize expenses' },
              { icon: Search, title: 'Demand', desc: 'Understand demand patterns' },
            ].map((item, i) => (
              <div key={i} className="bi-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <item.icon size={22} />
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, color: navy }}>{item.title}</div>
                <div style={{ fontSize: 12.5, color: gray500, lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 32, fontWeight: 800, fontSize: 15, color: tealDeep }}>
            Make decisions based on your business data, not guesswork.
          </p>
        </div>
      </div>

      {/* ── Staff, Locations, Offline ────────────────────────────── */}
      <div className="ops-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: `linear-gradient(180deg, ${bg} 0%, #fff 100%)` }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { icon: Users, title: 'Your Team. Your Business. Your Control.', desc: 'Manage staff accounts, roles, responsibilities and access from a centralized platform. CareHub helps business owners and managers maintain better operational control as their teams grow.' },
              { icon: MapPin, title: 'One Business. Multiple Locations. One System.', desc: 'CareHub supports growing businesses that operate across multiple locations, helping owners and managers maintain centralized visibility and control over operations.' },
              { icon: WifiOff, title: 'Keep Your Business Moving.', desc: 'CareHub is designed with offline capability to support essential business operations when internet connectivity is unavailable.' },
            ].map((card, i) => (
              <div key={i} className="ops-card" style={{ background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <card.icon size={22} />
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, color: navy, marginBottom: 6 }}>{card.title}</div>
                <div style={{ fontSize: 13.5, color: gray500, lineHeight: 1.6 }}>{card.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Who CareHub Is For ────────────────────────────────── */}
      <div className="who-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Built for the Businesses That Keep Healthcare, Wellness and Personal Care Moving.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 16 }}>
            {[
              { icon: '\u{1F48A}', title: 'Pharmacies', desc: 'Inventory, sales, staff, customers, locations and related pharmacy operations.' },
              { icon: '\u{1F3E5}', title: 'Hospitals and clinics', desc: 'Business operations, appointments, staff, patients/clients and locations.' },
              { icon: '\u{1F9EA}', title: 'Laboratories', desc: 'Operations, services, clients, staff and business information.' },
              { icon: '\u2728', title: 'Aesthetic clinics', desc: 'Services, appointments, staff, clients and relevant product operations.' },
              { icon: '\u{1F33F}', title: 'Spas and wellness centres', desc: 'Appointments, services, staff, clients and product sales.' },
              { icon: '\u{1F484}', title: 'Cosmetics and beauty businesses', desc: 'Products, inventory, sales, staff and customer management.' },
              { icon: '\u{1F487}', title: 'Hair-care businesses and salons', desc: 'Appointments, services, staff, customers and product management.' },
              { icon: '\u{1F3E5}', title: 'Other eligible businesses', desc: 'Healthcare, wellness, beauty and personal-care businesses.' },
            ].map((item, i) => (
              <div key={i} className="who-card" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, background: cardBg, borderRadius: theme.radius.lg, border: `1px solid ${border}` }}>
                <div style={{ fontSize: 24, flexShrink: 0 }}>{item.icon}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 13, color: gray500, lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Why CareHub ──────────────────────────────────────── */}
      <div className="why-section" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: `linear-gradient(180deg, ${bg} 0%, #fff 100%)` }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Why CareHub
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
            {[
              'Fully designed for healthcare and related service businesses',
              'Business-specific tools based on the business type selected during signup',
              'One platform for core operations',
              'Greater visibility across the CareFind health social platform',
              'Intelligent technology designed to support smarter decisions',
              'Scalable for single and multiple-location businesses',
              '30-day free trial to experience the platform before committing',
            ].map((item, i) => (
              <div key={i} className="why-item" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: gray600 }}>
                <CheckIcon size={16} color={tealDeep} strokeWidth={3} />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pricing ───────────────────────────────────────────── */}
      <div id="pricing" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 24 : 32, color: navy, margin: '0 0 8px' }}>
              Plain pricing in Naira
            </h2>
            <p style={{ fontSize: 13.5, color: gray500 }}>Every plan includes POS, inventory, reports and your CareFind listing.</p>
          </div>
          <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {PLANS.map(([name, price, period, items, popular]) => (
              <div key={name} className="pricing-card" style={{
                background: popular ? `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)` : cardBg,
                borderRadius: theme.radius.xl,
                border: popular ? 'none' : `1px solid ${border}`,
                padding: isMobile ? 24 : 28,
                position: 'relative', display: 'flex', flexDirection: 'column',
                boxShadow: popular ? theme.elevation[3] : 'none',
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
                onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = theme.elevation[4] } }}
                onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = popular ? theme.elevation[3] : 'none' } }}
              >
                {popular && (
                  <div style={{ position: 'absolute', top: -10, left: 20, background: '#fff', color: tealDeep, fontSize: 10, fontWeight: 800, padding: '3px 12px', borderRadius: theme.radius.full, letterSpacing: '0.04em' }}>
                    MOST POPULAR
                  </div>
                )}
                <div style={{ fontWeight: 800, fontSize: 14, color: popular ? '#fff' : navy, marginBottom: 10 }}>{name}</div>
                <div style={{ marginBottom: 16 }}>
                  {price === 'Custom' ? (
                    <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 22, color: popular ? '#fff' : navy }}>Custom</span>
                  ) : (
                    <>
                      <span style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 28, color: popular ? '#fff' : navy }}>&#8358;{price}</span>
                      <span style={{ fontSize: 12, color: popular ? 'rgba(255,255,255,0.6)' : gray400 }}>{period}</span>
                    </>
                  )}
                </div>
                <div style={{ marginBottom: 20, flex: 1 }}>
                  {items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: popular ? 'rgba(255,255,255,0.8)' : gray500, padding: '5px 0' }}>
                      <CheckIcon size={12} color={popular ? '#fff' : tealDeep} strokeWidth={3} />
                      {it}
                    </div>
                  ))}
                </div>
                <button onClick={() => navigate('/register')} style={{
                  width: '100%', padding: 12, borderRadius: theme.radius.md,
                  border: popular ? 'none' : `1px solid ${border}`,
                  background: popular ? '#fff' : 'white',
                  color: popular ? tealDeep : navy,
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}>
                  {name === 'Enterprise' || name === 'Custom' ? 'Talk to us' : `Start with ${name}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Final CTA + Footer ─────────────────────────────────── */}
      <div className="cta-section" style={{ padding: isMobile ? '48px 24px' : '64px 24px', background: `linear-gradient(135deg, ${deepTeal} 0%, ${tealDeep} 100%)`, maxWidth: 1100, margin: isMobile ? '40px 0 0' : '40px auto 0', borderRadius: isMobile ? 0 : theme.radius.xl, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24 }}>
        <div style={{ maxWidth: 600 }}>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 22 : 30, color: '#fff', margin: '0 0 10px', lineHeight: 1.2 }}>
            Your Business Deserves a Smarter Way to Operate.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.6, maxWidth: 460 }}>
            Stop managing your business through scattered tools and disconnected processes. Bring your operations together, gain better control, increase your visibility and build for growth with technology designed around your business.
          </p>
        </div>
        <button onClick={() => navigate('/register')} style={{ padding: '15px 32px', borderRadius: theme.radius.md, border: 'none', background: '#fff', color: tealDeep, fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          Get Started Free <ArrowRight size={16} />
        </button>
      </div>
      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 600, background: `linear-gradient(135deg, ${deepTeal} 0%, ${tealDeep} 100%)`, padding: '0 24px 16px' }}>
        Manage smarter. Operate better. Get discovered. Grow with CareHub.
      </div>

      <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderTop: `1px solid ${border}`, marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: gray500 }}>
          <Logo size={18} />
          &copy; 2026 CareHub &middot; Part of the Care ecosystem
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {['Features', 'Pricing', 'CareFind', 'support@carehub.ng'].map(text => (
            text.startsWith('support')
              ? <span key={text} style={{ fontSize: 12, fontWeight: 600, color: gray500 }}>{text}</span>
              : text === 'CareFind'
                ? <a key={text} href="https://carefind.ng" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: gray500, textDecoration: 'none' }}>{text}</a>
                : <a key={text} href={`#${text.toLowerCase()}`} style={{ fontSize: 12, fontWeight: 600, color: gray500, textDecoration: 'none' }}>{text}</a>
          ))}
        </div>
      </div>
    </main>
  )
}
