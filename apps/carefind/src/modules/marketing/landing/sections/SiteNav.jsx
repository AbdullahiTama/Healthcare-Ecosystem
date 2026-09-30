import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import Logo from '../../../social-feed/Logo.jsx'
import { NAV_LINKS, ROUTES } from '../data/landingContent.js'

// The landing nav. Deliberately not the old floating glass pill: the page is
// light from top to bottom now, so the nav is a plain sticky bar that gains a
// bottom hairline once the page scrolls. Sticky rather than fixed, so it never
// overlays content and never has to invert its own colours.
//
// Mobile collapses to a single menu button opening a full-width panel — one
// primary action stays visible at all times, and every link keeps a visible
// focus ring (ACCESSIBILITY.md:16), which the previous version's borderless
// buttons did not have.

const BAR_HEIGHT = 64

function scrollToAnchor(id) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function NavLink({ link, onNavigate, style }) {
  if (link.to) {
    return (
      <Link to={link.to} onClick={onNavigate} style={style}>
        {link.label}
      </Link>
    )
  }
  return (
    <a href={`#${link.anchor}`} onClick={(e) => { e.preventDefault(); onNavigate?.(); scrollToAnchor(link.anchor) }} style={style}>
      {link.label}
    </a>
  )
}

export default function SiteNav() {
  const navigate = useNavigate()
  const { isMobile, isMobileOrTablet } = useBreakpoint()
  // Three tiers rather than two. At 768–1023px all five links plus both
  // buttons do not fit inside the 728px of usable width, so the link row
  // collapses to the menu button while the two primary actions stay visible.
  // Below 768px everything collapses.
  const showLinks = !isMobileOrTablet
  const showActions = !isMobile
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the mobile panel on Escape, and hand focus back to the button that
  // opened it so keyboard users are not stranded at the top of the document.
  const closeMenu = () => {
    setMenuOpen(false)
    menuRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // Stop the page behind the mobile panel from scrolling while it is open.
  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [menuOpen])

  const linkStyle = {
    fontSize: 14,
    fontWeight: 600,
    color: theme.textMid,
    textDecoration: 'none',
    padding: '10px 4px',
    minHeight: 44,
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    transition: `color ${theme.motion.fast} ${theme.motion.easeOut}`,
  }

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        background: scrolled ? 'rgba(247,245,239,0.94)' : theme.bg,
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: `1px solid ${scrolled ? theme.border : 'transparent'}`,
        transition: `background ${theme.motion.base} ${theme.motion.easeOut}, border-color ${theme.motion.base} ${theme.motion.easeOut}`,
      }}
    >
      <nav
        aria-label="Primary"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 20px',
          minHeight: BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Link to={ROUTES.home} aria-label="CareFind home" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', minHeight: 44 }}>
          <Logo size={26} tone="dark" />
        </Link>

        {showLinks && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            {NAV_LINKS.map((link) => (
              <NavLink key={link.label} link={link} style={linkStyle} />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {showActions && (
            <>
              <button
                type="button"
                onClick={() => navigate(ROUTES.login)}
                style={{
                  // 44x44 floor on both axes (ACCESSIBILITY.md:32) — at 18px of
                  // horizontal padding "Sign in" measured 42px wide, so the
                  // height alone was not enough.
                  minWidth: 44,
                  minHeight: 44,
                  padding: '0 18px',
                  borderRadius: theme.radius.full,
                  border: `1px solid ${theme.border}`,
                  background: '#fff',
                  color: theme.textDark,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => navigate(ROUTES.search)}
                style={{
                  minHeight: 44,
                  padding: '0 20px',
                  borderRadius: theme.radius.full,
                  border: 'none',
                  background: theme.tealDeep,
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Get started
              </button>
            </>
          )}

          {!showLinks && (
            <button
              type="button"
              ref={menuRef}
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              style={{
                width: 44,
                height: 44,
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.border}`,
                background: '#fff',
                color: theme.textDark,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          )}
        </div>
      </nav>

      {!showLinks && menuOpen && (
        <div
          id="landing-mobile-menu"
          style={{
            borderTop: `1px solid ${theme.hairline}`,
            background: theme.bg,
            padding: '12px 20px 20px',
            maxHeight: `calc(100vh - ${BAR_HEIGHT}px)`,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.label}
                link={link}
                onNavigate={closeMenu}
                style={{
                  ...linkStyle,
                  fontSize: 15,
                  borderBottom: `1px solid ${theme.hairline}`,
                  borderRadius: 0,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => { closeMenu(); navigate(ROUTES.login) }}
              style={{
                minHeight: 44,
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.border}`,
                background: '#fff',
                color: theme.textDark,
                fontWeight: 600,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { closeMenu(); navigate(ROUTES.search) }}
              style={{
                minHeight: 44,
                borderRadius: theme.radius.md,
                border: 'none',
                background: theme.tealDeep,
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Get started
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
