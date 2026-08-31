import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart, Package, Clipboard, Heart, BarChart2,
  Search, Users, WifiOff, MapPin, Check as CheckIcon,
  ArrowRight, Star, ChevronLeft, ChevronRight,
  Clock, Banknote, Wallet, CheckCircle,
} from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../styles/theme'
import { Logo } from '../components/ui'
import { BUSINESS_TYPES } from '../config/constants'
import { businessLucideIcon } from '../lib/utils'
import { useBreakpoint } from '../hooks/useBreakpoint'

gsap.registerPlugin(ScrollTrigger)

const { tealDeep, tealBright, deepTeal, tealMist, fontDisplay, bg, cardBg, navy, gray600, gray500, gray400, gray300, border } = theme

const FEATURES = [
  [ShoppingCart, 'Smart POS', 'Cash, transfer, POS machine, split payment, credit sales and sales on hold.'],
  [Package, 'Inventory', 'Stock levels, cost price, margins, Excel import and barcode scanning.'],
  [Heart, 'Hospital workflow', 'Reception to doctor to pharmacy, tracked in real time across every department.'],
  [BarChart2, 'Financial reports', 'Revenue, expenses and profit breakdown, exportable to Excel.'],
  [Search, 'CareFind listing', 'Get discovered by patients searching for healthcare near them.'],
  [Users, 'Staff & roles', 'Role-based access so each staff member only sees what they need.'],
  [WifiOff, 'Works offline', 'Sell without internet and sync automatically when you are back online.'],
  [MapPin, 'Multi-location', 'One login, multiple branches, side-by-side performance comparisons.'],
]

const PLANS = [
  ['Basic', '60,000', '/year', ['Up to 2 locations', 'Up to 5 staff', 'Up to 5,000 products', 'All core features', 'Hospitals excluded'], false],
  ['Growth', '100,000', '/year', ['Up to 5 locations', 'Unlimited products', 'Unlimited staff', 'All core features', 'Hospitals start here'], true],
  ['Premium', '150,000', '/year', ['Up to 10 locations', 'Unlimited products', 'Unlimited staff', 'All core features', 'Premium features'], false],
  ['Enterprise', '250,000', '/year', ['Up to 30 locations', 'Unlimited products', 'Unlimited staff', 'Personalized support', 'For large orgs & importers'], false],
  ['Custom', 'Custom', '', ['Bespoke to your org', 'Tailored locations & volume', 'Personalized support', 'Contact sales'], false],
]

const STEPS_DATA = [
  ['Register your business', 'Pick your business type and set up your first location in under five minutes.'],
  ['Add products or services', 'Import via Excel or add them one by one with prices, stock levels, and reorder points.'],
  ['Start selling', 'Ring up sales at the POS while CareFind brings new patients to your door.'],
]

const TESTIMONIALS = [
  ['AO', 'Adaeze Okafor', 'Superintendent Pharmacist', 'Lagos', 'We stopped guessing. Stock, sales and the books finally agree at the end of every day.'],
  ['MB', 'Dr. Musa Bello', 'Medical Director', 'Abuja', 'New patients mention CareFind at the front desk almost every week. The listing pays for the plan on its own.'],
  ['IE', 'Ifeoma Eze', 'Clinic Administrator', 'Enugu', 'Reception to pharmacy on one screen — my staff learned it in an afternoon, offline included.'],
]

const TESTIMONIAL_IMAGES = [
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&crop=faces',
  'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200&auto=format&fit=crop&crop=faces',
]

function Check() {
  return <CheckIcon size={13} color={tealDeep} strokeWidth={3} aria-hidden="true" />
}

export default function Landing() {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const sectionRef = useRef(null)
  const heroRef = useRef(null)
  const navRef = useRef(null)
  const stepsRef = useRef(null)
  const featuresRef = useRef(null)
  const testimonialsRef = useRef(null)
  const marqueeRef = useRef(null)
  const [activeTestimonial, setActiveTestimonial] = useState(0)
  const [navScrolled, setNavScrolled] = useState(false)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(heroRef.current?.querySelectorAll('.hero-fade'), {
        y: 50, opacity: 0, duration: 1, stagger: 0.18, ease: 'power3.out',
      })

      gsap.from(featuresRef.current?.querySelectorAll('.feature-card'), {
        scrollTrigger: { trigger: featuresRef.current, start: 'top 82%' },
        y: 40, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power2.out',
      })

      gsap.utils.toArray('.step-card').forEach((card, i) => {
        gsap.from(card, {
          scrollTrigger: {
            trigger: card, start: 'top 85%', end: 'top 40%',
            toggleActions: 'play none none reverse',
          },
          y: 60, opacity: 0, scale: 0.92, duration: 0.7, ease: 'power2.out',
          delay: i * 0.15,
        })
      })

      gsap.from(marqueeRef.current?.querySelectorAll('.marquee-item'), {
        scrollTrigger: { trigger: marqueeRef.current, start: 'top 90%' },
        x: -40, opacity: 0, duration: 0.6, stagger: 0.06, ease: 'power2.out',
      })

      gsap.from(testimonialsRef.current?.querySelectorAll('.testimonial-fade'), {
        scrollTrigger: { trigger: testimonialsRef.current, start: 'top 85%' },
        y: 30, opacity: 0, duration: 0.7, ease: 'power2.out',
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

    const interval = setInterval(() => {
      setActiveTestimonial(p => (p + 1) % TESTIMONIALS.length)
    }, 5000)

    return () => { ctx.revert(); clearInterval(interval) }
  }, [])

  return (
    <main ref={sectionRef} style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, overflowX: 'hidden', width: '100%', maxWidth: '100%', color: navy }}>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-track { animation: marquee 40s linear infinite; }
        .marquee-track:hover { animation-play-state: paused; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .testimonial-card { animation: fadeIn 0.5s ease-out; }
      `}</style>

      {/* ── Glass Nav ─────────────────────────────────────────── */}
      <nav ref={navRef} style={{
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
          <button onClick={() => navigate('/register')} style={{ padding: '7px 16px', borderRadius: 40, border: 'none', background: '#fff', color: deepTeal, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Get started</button>
        </div>
      </nav>

      {/* ── Hero — Black counter reality, deep-teal luxury ────────── */}
      <div ref={heroRef} role="img" aria-label="Black pharmacist at a pharmacy counter in Lagos handing medication to a mother and child, shelves stocked with medicines behind, warm afternoon light" style={{
        minHeight: '90vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundImage: `linear-gradient(135deg, ${deepTeal}E6 0%, ${tealDeep}D9 50%, #0D5F4DE6 100%), url(https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1600&q=80&auto=format&fit=crop)`,
        backgroundSize: 'cover', backgroundPosition: 'center 30%',
        position: 'relative', overflow: 'hidden', padding: isMobile ? '120px 20px 80px' : '140px 24px 100px',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.06) 0%, transparent 55%)',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 900, margin: '0 auto' }}>
          <div className="hero-fade" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 16, backdropFilter: 'blur(6px)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.6)' }} /> 1,142 businesses · 6 states · Works offline
          </div>
          <h1 className="hero-fade" style={{
            fontFamily: fontDisplay, fontWeight: 700,
            fontSize: isMobile ? 'clamp(32px, 8vw, 42px)' : 'clamp(42px, 5vw, 60px)',
            lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', margin: '0 0 16px',
            maxWidth: 900, textWrap: 'balance',
          }}>
            Pharmacy counter, lab bench, or ward — one login.
          </h1>
          <p className="hero-fade" style={{ fontSize: isMobile ? 14 : 16, color: 'rgba(255,255,255,0.82)', maxWidth: 600, margin: '0 auto 28px', lineHeight: 1.7, fontWeight: 500 }}>
            Sales, inventory, staff and patient workflow in one calm, reliable platform — for pharmacies, hospitals, labs and clinics across Nigeria.
          </p>
          <div className="hero-fade" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/register')} style={{ padding: '14px 30px', borderRadius: theme.radius.md, border: 'none', background: '#fff', color: deepTeal, fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
              Get started free <ArrowRight size={16} />
            </button>
            <a href="#pricing" style={{ padding: '14px 30px', borderRadius: theme.radius.md, border: '1px solid rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', backdropFilter: 'blur(6px)' }}>See pricing — from ₦60k/year</a>
          </div>
          <div className="hero-fade" style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24, padding: '10px 16px', borderRadius: 999, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
            {['Free 14-day trial', 'Works offline', '₦60k/year'].map(c => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.88)', fontWeight: 600 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: tealBright, flexShrink: 0, boxShadow: '0 0 6px rgba(45,212,191,0.6)' }} />
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Business Types Strip — Black owners, real faces ─────── */}
      <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: gray400, marginBottom: 16 }}>Built for every healthcare business — by people like you</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {BUSINESS_TYPES.map(b => {
            const TYPE_IMAGES = {
              skincare: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=100&auto=format&fit=crop&crop=faces',
              pharmacy: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=100&auto=format&fit=crop&crop=faces',
              hospital: 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=100&auto=format&fit=crop&crop=faces',
              dental: 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?w=100&auto=format&fit=crop&crop=faces',
              optical: 'https://images.unsplash.com/photo-1527613426441-4da17471b66d?w=100&auto=format&fit=crop&crop=faces',
              wellness: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&auto=format&fit=crop&crop=faces',
              manufacturer_importer: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&auto=format&fit=crop&crop=faces',
              wholesale: 'https://images.unsplash.com/photo-1551836022-deb4988cc6c0?w=100&auto=format&fit=crop&crop=faces',
            }
            const img = TYPE_IMAGES[b.id] || TYPE_IMAGES.pharmacy
            return (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 6px', borderRadius: 999, border: `1px solid ${border}`, background: 'white', fontSize: 12.5, fontWeight: 700, color: navy, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <img src={img} alt={`${b.name} — Black owner in Nigeria`} width={30} height={30} loading="lazy" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${tealMist}` }} onError={e => { e.currentTarget.style.display = 'none' }} />
                {b.name}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Features Bento ────────────────────────────────────── */}
      <div id="features" ref={featuresRef} style={{ padding: '60px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 36, color: navy, margin: '0 0 12px', lineHeight: 1.2 }}>
            One platform for the counter, the storeroom and the books.
          </h2>
          <p style={{ fontSize: 14, color: gray500, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            Everything you need to run your healthcare business, from point-of-sale to patient discovery.
          </p>
        </div>
        <div style={{
          display: 'grid', gridAutoFlow: 'dense',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 12,
        }}>
          {[
            { icon: ShoppingCart, title: 'Smart POS', desc: 'Cash, transfer, POS machine, split payment, credit sales and sales on hold in one streamlined interface.', span: true },
            { icon: Package, title: 'Inventory', desc: 'Stock levels, cost price, margins, Excel import and barcode scanning at your fingertips.' },
            { icon: BarChart2, title: 'Reports & analytics', desc: 'Revenue, expenses and profit breakdown with real-time dashboards exportable to Excel.' },
          ].map((item, i) => (
            <div key={i} className="feature-card" style={{
              gridColumn: item.span && !isMobile ? 'span 2' : 'span 1',
              gridRow: item.span && !isMobile ? 'span 2' : 'span 1',
              background: item.span && !isMobile ? `linear-gradient(135deg, ${tealDeep} 0%, ${deepTeal} 100%)` : 'white',
              borderRadius: theme.radius.xl,
              border: item.span && !isMobile ? 'none' : `1px solid ${border}`,
              padding: item.span && !isMobile ? 32 : 24,
              display: 'flex', flexDirection: 'column', justifyContent: item.span && !isMobile ? 'center' : 'flex-start',
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            }}
              onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = theme.elevation[3] } }}
              onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 14,
                background: item.span && !isMobile ? 'rgba(255,255,255,0.15)' : tealMist,
                color: item.span && !isMobile ? '#fff' : tealDeep,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 16,
              }}>
                <item.icon size={22} />
              </div>
              <div style={{
                fontWeight: 800, fontSize: item.span && !isMobile ? 18 : 14,
                color: item.span && !isMobile ? '#fff' : navy, marginBottom: 8,
              }}>{item.title}</div>
              <div style={{
                fontSize: item.span && !isMobile ? 14 : 12.5,
                color: item.span && !isMobile ? 'rgba(255,255,255,0.75)' : gray500,
                lineHeight: 1.65,
              }}>{item.desc}</div>
            </div>
          ))}
          {[
            { icon: Users, title: 'Staff & roles' },
            { icon: Search, title: 'CareFind listing' },
            { icon: MapPin, title: 'Multi-location' },
            { icon: WifiOff, title: 'Works offline' },
          ].map((item, i) => (
            <div key={i + 3} className="feature-card" style={{
              gridColumn: 'span 1', gridRow: 'span 1',
              background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`,
              padding: 20, display: 'flex', alignItems: 'center', gap: 14,
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              cursor: 'default',
            }}
              onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = theme.elevation[2] } }}
              onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <item.icon size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: navy }}>{item.title}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Services ──────────────────────────────────────────── */}
      <div style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Services, your way
            </h2>
            <p style={{ fontSize: 14, color: gray500, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
              List what you offer, set your availability, and let clients book — all from one place.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { icon: Clipboard, title: 'Create & list services', desc: 'Add services with pricing, duration and descriptions. Edit anytime.' },
              { icon: Clock, title: 'Set your availability', desc: 'Control which days and hours clients can book. No more double-bookings.' },
              { icon: BarChart2, title: 'Track bookings & revenue', desc: 'See upcoming appointments, completed sessions and earnings at a glance.' },
            ].map((item, i) => (
              <div key={i} className="feature-card" style={{
                background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`,
                padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
                onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = theme.elevation[3] } }}
                onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <item.icon size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: navy, marginBottom: 6 }}>{item.title}</div>
                  <div style={{ fontSize: 13.5, color: gray500, lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Appointment Flow ───────────────────────────────────── */}
      <div style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: `linear-gradient(180deg, ${bg} 0%, #fff 100%)` }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Book, pay, complete — all in one flow
            </h2>
            <p style={{ fontSize: 14, color: gray500, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
              Your clients pick a service, choose a time, pay securely, and you confirm — done.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { icon: Search, title: 'Select a service', desc: 'Clients browse your listed services and pick one.' },
              { icon: Clock, title: 'Pick a date & time', desc: 'Available slots show automatically based on your schedule.' },
              { icon: Banknote, title: 'Pay securely with card', desc: 'Payments are processed instantly via Paystack.' },
              { icon: CheckCircle, title: 'Confirm & complete', desc: 'You confirm the booking. Funds are held until the session is done.' },
              { icon: ArrowRight, title: 'Withdraw to your bank', desc: 'Earnings move to your wallet and out to your bank within 24 hours.' },
            ].map((item, i) => (
              <div key={i} className="step-card" style={{
                background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`,
                padding: isMobile ? 20 : 24, display: 'flex', alignItems: 'flex-start', gap: 16,
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
                onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateX(6px)'; e.currentTarget.style.boxShadow = theme.elevation[3] } }}
                onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none' } }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: theme.radius.full,
                  background: tealMist, color: tealDeep,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 900, flexShrink: 0,
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: isMobile ? 15 : 16, color: navy, marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 13.5, color: gray500, lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Payment & Payout ───────────────────────────────────── */}
      <div style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Get paid fast, stay in control
            </h2>
            <p style={{ fontSize: 14, color: gray500, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
              Payments are held safely, released when you confirm, and withdrawn on your terms.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { icon: Wallet, title: 'Funds held safely', desc: 'Client payments are secured in your business wallet until the appointment is complete.' },
              { icon: CheckIcon, title: 'Released on completion', desc: 'Once you confirm the session, funds move to your available balance instantly.' },
              { icon: Banknote, title: 'Withdraw to bank', desc: 'Request a payout anytime. Funds arrive in your bank account within 24 hours.' },
            ].map((item, i) => (
              <div key={i} className="feature-card" style={{
                background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${border}`,
                padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
                onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = theme.elevation[3] } }}
                onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' } }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <item.icon size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: navy, marginBottom: 6 }}>{item.title}</div>
                  <div style={{ fontSize: 13.5, color: gray500, lineHeight: 1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Steps with GSAP ───────────────────────────────────── */}
      <div ref={stepsRef} style={{
        background: `linear-gradient(180deg, ${theme.bg} 0%, #fff 100%)`,
        padding: '80px 24px', borderTop: `1px solid ${theme.border}`,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px' }}>
              Selling within the hour, not the week.
            </h2>
            <p style={{ fontSize: 14, color: theme.gray500, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
              Three steps to get your business online and selling.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {STEPS_DATA.map(([title, desc], i) => (
              <div key={i} className="step-card" style={{
                background: 'white', borderRadius: theme.radius.xl, border: `1px solid ${theme.border}`,
                padding: isMobile ? 24 : 32, display: 'flex', alignItems: 'flex-start', gap: 20,
                transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              }}
                onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateX(6px)'; e.currentTarget.style.boxShadow = theme.elevation[3] } }}
                onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none' } }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: theme.radius.full,
                  background: theme.tealMist, color: theme.tealDeep,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 900, flexShrink: 0,
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, color: navy, marginBottom: 6 }}>{title}</div>
                  <div style={{ fontSize: 13.5, color: theme.gray500, lineHeight: 1.65, maxWidth: 520 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Infinite Marquee ──────────────────────────────────── */}
      <div ref={marqueeRef} style={{
        padding: '40px 0', overflow: 'hidden', borderTop: `1px solid ${border}`,
        background: 'white',
      }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: gray400, textAlign: 'center', marginBottom: 20 }}>Trusted by healthcare businesses across Nigeria</p>
        <div className="marquee-track" style={{ display: 'flex', gap: 40, whiteSpace: 'nowrap', width: 'max-content' }}>
          {[...BUSINESS_TYPES, ...BUSINESS_TYPES].map((b, i) => (
            <span key={i} className="marquee-item" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: gray500 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: tealMist }} />
              {b.name}
            </span>
          ))}
        </div>
      </div>

      {/* ── Testimonial Carousel ──────────────────────────────── */}
      <div ref={testimonialsRef} style={{ padding: '80px 24px', maxWidth: 800, margin: '0 auto', borderTop: `1px solid ${theme.border}` }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 24 : 32, color: navy, margin: '0 0 10px' }}>
            Loved by healthcare teams
          </h2>
          <p style={{ fontSize: 13.5, color: theme.gray500 }}>From pharmacy counters to hospital administrations across Nigeria.</p>
        </div>
        <div className="testimonial-card" style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: fontDisplay, fontSize: 48, fontWeight: 700, color: theme.tealDeep, lineHeight: 1, marginBottom: 12, opacity: 0.15 }}>&ldquo;</div>
          <p style={{ fontSize: isMobile ? 16 : 20, color: navy, lineHeight: 1.6, maxWidth: 640, margin: '0 auto 28px', fontWeight: 500, fontStyle: 'italic' }}>
            {TESTIMONIALS[activeTestimonial][4]}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <img src={TESTIMONIAL_IMAGES[activeTestimonial]} alt={`${TESTIMONIALS[activeTestimonial][1]} — ${TESTIMONIALS[activeTestimonial][2]} in ${TESTIMONIALS[activeTestimonial][3]}, Black healthcare owner in Nigeria`} width={44} height={44} loading="lazy" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${tealMist}`, flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none' }} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: navy, display: 'flex', alignItems: 'center', gap: 6 }}>{TESTIMONIALS[activeTestimonial][1]} <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 999, background: tealMist, color: tealDeep, fontSize: 10, fontWeight: 800 }}>✓ Verified</span></div>
              <div style={{ fontSize: 12, color: theme.gray400 }}>{TESTIMONIALS[activeTestimonial][2]} &middot; {TESTIMONIALS[activeTestimonial][3]}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 24 }}>
            {TESTIMONIALS.map((_, i) => (
              <button key={i} onClick={() => setActiveTestimonial(i)} aria-label={`Testimonial ${i + 1}`} style={{
                width: i === activeTestimonial ? 24 : 8, height: 8, borderRadius: theme.radius.sm,
                border: 'none', cursor: 'pointer',
                background: i === activeTestimonial ? theme.tealDeep : theme.gray300,
                transition: 'all 0.3s ease',
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button onClick={() => setActiveTestimonial(p => p === 0 ? TESTIMONIALS.length - 1 : p - 1)} aria-label="Previous testimonial" style={{ width: 36, height: 36, borderRadius: theme.radius.full, border: `1px solid ${theme.border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.gray500 }}>
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => setActiveTestimonial(p => (p + 1) % TESTIMONIALS.length)} aria-label="Next testimonial" style={{ width: 36, height: 36, borderRadius: theme.radius.full, border: `1px solid ${theme.border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.gray500 }}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Pricing Grid ──────────────────────────────────────── */}
      <div id="pricing" style={{ padding: '80px 24px', borderTop: `1px solid ${border}`, background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 24 : 32, color: navy, margin: '0 0 8px' }}>
              Plain pricing in Naira
            </h2>
            <p style={{ fontSize: 13.5, color: gray500 }}>Every plan includes POS, inventory, reports and your CareFind listing.</p>
          </div>
          <div className="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}>
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
                      <CheckIcon size={12} color={popular ? '#fff' : tealDeep} strokeWidth={3} aria-hidden="true" />
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
                }}
                  onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.opacity = '0.9' } }}
                  onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.opacity = '1' } }}
                >
                  {name === 'Enterprise' || name === 'Custom' ? 'Talk to us' : `Start with ${name}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Become a Referral Agent ─────────────────────────────── */}
      <div className="referral-section" style={{ padding: '80px 24px', maxWidth: 900, margin: '0 auto', borderTop: `1px solid ${border}`, textAlign: 'center' }}>
        <div style={{ marginBottom: 16, display: 'inline-flex', padding: '8px 16px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>
          EARN WHILE YOU INTRODUCE
        </div>
        <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 26 : 34, color: navy, margin: '0 0 12px', lineHeight: 1.2 }}>
          Become a CareHub Referral Agent.
        </h2>
        <p style={{ fontSize: 14.5, color: gray500, maxWidth: 560, margin: '0 auto 20px', lineHeight: 1.7 }}>
          Own one area. Earn <strong style={{ color: tealDeep }}>40% of the first payment</strong> on every healthcare business you bring in, then <strong style={{ color: tealDeep }}>5% on every renewal</strong> for as long as they stay. Real public in your neighbourhood, recurring income for you.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[
              'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=80&auto=format&fit=crop&crop=faces',
              'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&auto=format&fit=crop&crop=faces',
              'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=80&auto=format&fit=crop&crop=faces',
            ].map((src, i) => (
              <img key={i} src={src} alt="Black referral agent in Nigeria" width={32} height={32} loading="lazy" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid white', marginLeft: i === 0 ? 0 : -8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }} onError={e => { e.currentTarget.style.display = 'none' }} />
            ))}
            <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: navy, background: tealMist, padding: '4px 10px', borderRadius: 999 }}>+84 agents</span>
          </div>
          <span style={{ fontSize: 12, color: gray400, fontWeight: 600 }}>Own your area — Surulere, Garki, Bodija</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button onClick={() => navigate('/apply-agent')} style={{
            padding: '15px 32px', borderRadius: theme.radius.md, border: 'none',
            background: tealDeep, color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 20px rgba(14,111,90,0.25)'
          }}>
            Apply to cover your area <ArrowRight size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24 }}>
          {['Free to apply', 'No purchase needed', 'You keep your day job'].map(c => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: gray500 }}>
              <CheckIcon size={13} color={tealDeep} strokeWidth={3} aria-hidden="true" />
              {c}
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <div className="cta-section" style={{
        padding: isMobile ? '48px 24px' : '64px 24px',
        background: `linear-gradient(135deg, ${deepTeal} 0%, ${tealDeep} 100%)`,
        maxWidth: 1100, margin: isMobile ? '0' : '0 auto',
        borderRadius: isMobile ? 0 : theme.radius.xl,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 24,
      }}>
        <div style={{ maxWidth: 600 }}>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: isMobile ? 22 : 30, color: '#fff', margin: '0 0 10px', lineHeight: 1.2 }}>
            Your patients are already searching on CareFind.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0, fontSize: 14, lineHeight: 1.6, maxWidth: 460 }}>
            Register your business and be visible to thousands of patients looking for healthcare near them.
          </p>
        </div>
        <button onClick={() => navigate('/register')} style={{
          padding: '15px 32px', borderRadius: theme.radius.md, border: 'none',
          background: '#fff', color: tealDeep, fontWeight: 800, fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          transition: 'transform 0.2s ease',
        }}
          onMouseEnter={e => { if (!isMobile) { e.currentTarget.style.transform = 'scale(1.04)' } }}
          onMouseLeave={e => { if (!isMobile) { e.currentTarget.style.transform = 'scale(1)' } }}
        >
          Get started free <ArrowRight size={16} />
        </button>
      </div>

      {/* ── Footer ────────────────────────────────────────────── */}
      <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderTop: `1px solid ${border}`, marginTop: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: gray500 }}>
          <Logo size={18} />
          &copy; 2026 CareHub &middot; Part of the Care ecosystem
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {['Features', 'Pricing', 'CareFind', 'support@carehub.ng'].map(text => (
            text.startsWith('support')
              ? <span key={text} style={{ fontSize: 12, fontWeight: 600, color: gray500 }}>{text}</span>
              : <a key={text} href={`#${text.toLowerCase()}`} style={{ fontSize: 12, fontWeight: 600, color: gray500, textDecoration: 'none' }}>{text}</a>
          ))}
        </div>
      </div>
    </main>
  )
}