import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Logo } from '../ui'

const { tealDeep } = theme

// Glass pill nav for the CareHub landing. Fixed pill turns solid after 80px;
// wordmark color flips between white (over hero) and teal (solid state).
//
// No role="banner" here: the page wraps this in <header>, which is the banner
// landmark. Claiming it a second time duplicates that landmark AND overrides
// the <nav>'s own implicit navigation role, leaving the page with two banners
// and nothing to jump to for the nav. Same fix as CareFind's LandingNav.
export default function LandingNav({ links = [], signInTo = '/login', getStartedTo = '/register' }) {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const renderTarget = ({ label, target }) => {
    const style = {
      padding: '6px 12px', fontSize: 13, fontWeight: 600,
      color: scrolled ? tealDeep : 'rgba(255,255,255,0.8)',
      textDecoration: 'none', transition: 'color 0.3s ease',
    }
    return target.startsWith('#') ? (
      <a key={label} href={target} style={style}
        onClick={(e) => { e.preventDefault(); document.getElementById(target.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
        {label}
      </a>
    ) : (
      <Link key={label} to={target} style={style}>{label}</Link>
    )
  }

  return (
    <nav aria-label="Primary" style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      background: scrolled ? '#fff' : 'rgba(255,255,255,0.05)',
      backdropFilter: 'blur(20px)',
      borderRadius: 64, padding: '8px 10px 8px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
      border: scrolled ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.08)',
      transition: 'background 0.3s ease, border 0.3s ease',
    }}>
      <Link to="/" aria-label="CareHub home" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <Logo size={28} />
        <span style={{
          fontWeight: 900, fontSize: 16, letterSpacing: '-0.01em',
          color: scrolled ? tealDeep : '#fff', transition: 'color 0.3s ease',
        }}>
          CareHub
        </span>
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 20 }}>
        {!isMobile && links.map(renderTarget)}
        <button type="button" onClick={() => navigate(signInTo)} style={{
          padding: '7px 14px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit',
          border: scrolled ? `1px solid ${tealDeep}` : '1px solid rgba(255,255,255,0.25)',
          background: 'transparent', color: scrolled ? tealDeep : '#fff',
          fontWeight: 600, fontSize: 13, transition: 'color 0.3s ease, border 0.3s ease',
        }}>
          Sign in
        </button>
        <button type="button" onClick={() => navigate(getStartedTo)} style={{
          padding: '7px 16px', borderRadius: 40, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: '#fff', color: theme.deepTeal, fontWeight: 700, fontSize: 13,
        }}>
          Get started
        </button>
      </div>
    </nav>
  )
}
