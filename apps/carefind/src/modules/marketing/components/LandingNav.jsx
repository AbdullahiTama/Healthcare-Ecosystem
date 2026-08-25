import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import Logo from '../../social-feed/Logo.jsx'

const { navy, border } = theme

// Glass pill nav shared by marketing pages. Anchor targets smooth-scroll,
// route targets navigate. Turns solid after 80px of scroll (plain scroll
// listener — no ScrollTrigger needed for this).
export default function LandingNav({
  links = [], signInTo = '/login', getStartedTo = '/search', getStartedLabel = 'Get started',
}) {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const renderTarget = ({ label, target }) => (
    target.startsWith('#') ? (
      <a key={label} href={target}
        onClick={(e) => { e.preventDefault(); document.getElementById(target.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
        style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, color: scrolled ? navy : '#fff', opacity: 0.85, textDecoration: 'none' }}>
        {label}
      </a>
    ) : (
      <Link key={label} to={target}
        style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, color: scrolled ? navy : '#fff', opacity: 0.85, textDecoration: 'none' }}>
        {label}
      </Link>
    )
  )

  return (
    // No role="banner" here: the pages wrap this in <header>, which is the
    // banner landmark, and claiming it a second time both duplicated that
    // landmark and overrode the <nav>'s own implicit navigation role — so the
    // page exposed two banners and no navigation landmark at all.
    <nav aria-label="Primary" style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      background: scrolled ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
      backdropFilter: scrolled ? 'blur(16px)' : 'blur(0px)',
      borderRadius: 60, padding: '8px 10px 8px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
      border: `1px solid ${scrolled ? border : 'rgba(255,255,255,0.15)'}`,
      transition: 'background 0.3s ease',
    }}>
      <Link to="/" aria-label="CareFind home" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
        <Logo size={24} tone={isMobile || scrolled ? 'dark' : 'light'} />
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isMobile && links.map(renderTarget)}
        <button onClick={() => navigate(signInTo)} style={{
          padding: '8px 16px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit',
          border: `1px solid ${scrolled ? border : 'rgba(255,255,255,0.3)'}`,
          background: 'transparent', color: scrolled ? navy : '#fff', fontWeight: 600, fontSize: 13,
        }}>
          Sign in
        </button>
        <button onClick={() => navigate(getStartedTo)} style={{
          padding: '8px 18px', borderRadius: 40, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: '#fff', color: navy, fontWeight: 700, fontSize: 13,
        }}>
          {getStartedLabel}
        </button>
      </div>
    </nav>
  )
}
