import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Package, ShoppingCart, Users, Heart, BarChart2, Search, MapPin, Clipboard, Clock, Eye, AlertCircle } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../styles/theme'
import { Logo } from '../components/ui'
import { BUSINESS_TYPES } from '../config/constants'
import { useBreakpoint } from '../hooks/useBreakpoint'

gsap.registerPlugin(ScrollTrigger)

const { tealDeep, tealBright, deepTeal, tealMist, fontDisplay, bg, cardBg, navy, gray600, gray500, gray400, gray300, border } = theme

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

      {/* Sections added by Tasks 4-15 */}
    </main>
  )
}
