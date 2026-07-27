import { Link, useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, MessageCircle, Search, Shield, Star, Users } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import Logo from '../social-feed/Logo.jsx'

const { tealDeep, tealMist, fontDisplay, bg, navy, textMid, textLight, border } = theme

const FEATURES = [
  [Search, 'Find care near you', 'Search medicines, pharmacies, hospitals and labs in your area. Real listings, real locations.'],
  [Star, 'Real patient reviews', 'See what actual patients say before you book. Every review comes from a verified visit.'],
  [MessageCircle, 'Connect on WhatsApp', 'Message providers directly. No extra app, no phone tag, just tap and talk.'],
  [Shield, 'Verified providers', 'Every business on CareFind is verified. Your health deserves nothing less.'],
]

const STEPS = [
  ['1', 'Search', 'Find the medicine, pharmacy, hospital or lab you need near you.'],
  ['2', 'Compare', 'Read reviews, check ratings, compare options side by side.'],
  ['3', 'Connect', 'Message the provider on WhatsApp or visit them to get the care you need.'],
]

function Eyebrow({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: tealDeep, marginBottom: 10 }}>
      {children}
    </div>
  )
}

function NavLink({ href, children }) {
  return <a href={href} style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>{children}</a>
}

function IconTile({ Icon, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.32, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={size * 0.48} aria-hidden="true" />
    </div>
  )
}

export default function ForBusiness() {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  return (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: bg, overflowX: 'hidden', color: navy }}>
      {/* Nav */}
      <nav style={{ background: 'white', borderBottom: `1px solid ${border}`, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10, gap: 12 }}>
        <Link to="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
          <Logo size={28} tone="dark" />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 28 }}>
          {!isMobile && (
            <div style={{ display: 'flex', gap: 24 }}>
              <NavLink href="#features">Features</NavLink>
              <NavLink href="#how-it-works">How it works</NavLink>
              <Link to="/feed" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>Feed</Link>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 10 }}>
            {isMobile
              ? <button onClick={() => navigate('/login')} style={{ padding: 0, border: 'none', background: 'none', color: navy, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Sign in</button>
              : <button onClick={() => navigate('/login')} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Sign in</button>}
            <button onClick={() => navigate('/search')} style={{ padding: isMobile ? '9px 14px' : '9px 16px', borderRadius: 10, border: 'none', background: tealDeep, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>Get started</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ padding: '80px 24px 72px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 700, marginBottom: 22 }}>
            <Activity size={14} /> Your health marketplace
          </div>
          <h1 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 'clamp(32px,4.8vw,52px)', lineHeight: 1.12, letterSpacing: '-0.02em', margin: '0 0 18px', color: navy }}>
            Find the care you need,{isMobile ? ' ' : <br />}right where you are.
          </h1>
          <p style={{ fontSize: 16, color: textMid, maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.7 }}>
            Search medicines, compare pharmacies, read real reviews, and connect with healthcare providers near you — all in one place.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 24 }}>
            <button onClick={() => navigate('/search')} style={{ padding: '14px 28px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Start searching <ArrowRight size={18} />
            </button>
            <button onClick={() => navigate('/feed')} style={{ padding: '14px 28px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Browse feed
            </button>
          </div>
          <p style={{ fontSize: 12.5, color: textLight, margin: 0 }}>
            Healthcare businesses — <Link to="/claim-business" style={{ color: tealDeep, fontWeight: 700 }}>claim your listing</Link> and reach patients today.
          </p>
        </div>
      </div>

      {/* Features */}
      <div id="features" style={{ borderTop: `1px solid ${border}`, padding: '60px 24px 64px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <Eyebrow>Why CareFind</Eyebrow>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 28, color: navy, margin: '0 0 32px', maxWidth: 560, lineHeight: 1.25 }}>Everything you need to make informed health decisions.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16 }}>
            {FEATURES.map(([Icon, title, desc]) => (
              <div key={title} style={{ background: 'white', padding: 20, borderRadius: theme.radius.lg, border: `1px solid ${border}` }}>
                <IconTile Icon={Icon} />
                <div style={{ fontWeight: 800, fontSize: 14, color: navy, margin: '14px 0 6px' }}>{title}</div>
                <div style={{ fontSize: 12.5, color: textMid, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div id="how-it-works" style={{ borderTop: `1px solid ${border}`, padding: '60px 24px 64px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <Eyebrow>How it works</Eyebrow>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 26, color: navy, margin: '0 0 32px' }}>Three steps to better care.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 20 }}>
            {STEPS.map(([n, title, desc]) => (
              <div key={n} style={{ background: 'white', padding: 20, borderRadius: theme.radius.lg, border: `1px solid ${border}` }}>
                <div style={{ width: 28, height: 28, borderRadius: theme.radius.full, border: `1.5px solid ${tealDeep}`, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, marginBottom: 14 }}>{n}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: navy, marginBottom: 6 }}>{title}</div>
                <div style={{ fontSize: 12.5, color: textMid, lineHeight: 1.65 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ background: tealDeep, padding: '44px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20, maxWidth: 1140, margin: '0 auto', borderRadius: theme.radius.lg }}>
        <div>
          <h2 style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 24, color: 'white', margin: '0 0 6px' }}>Ready to find the care you need?</h2>
          <p style={{ color: 'rgba(255,255,255,0.75)', margin: 0, fontSize: 13.5 }}>Join thousands of patients using CareFind every day.</p>
        </div>
        <button onClick={() => navigate('/search')} style={{ padding: '13px 26px', borderRadius: theme.radius.md, border: 'none', background: 'white', color: tealDeep, fontWeight: 800, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>Start searching</button>
      </div>

      {/* Footer */}
      <div style={{ padding: '28px 24px', maxWidth: 1140, margin: '40px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderTop: `1px solid ${border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: textLight }}>
          <Logo size={18} tone="dark" markOnly />
          &copy; 2026 CareFind &middot; Part of the Care ecosystem
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          <Link to="/feed" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>Feed</Link>
          <Link to="/claim-business" style={{ fontSize: 13, fontWeight: 600, color: textMid, textDecoration: 'none' }}>For businesses</Link>
        </div>
      </div>
    </div>
  )
}