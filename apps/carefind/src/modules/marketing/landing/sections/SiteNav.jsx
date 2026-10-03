import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import Logo from '../../../social-feed/Logo.jsx'
import { NAV_LINKS, ROUTES } from '../data/landingContent.js'

// The landing header: logo left; Sign in, Get started and the menu button
// right. It sits over the hero photograph (transparent — the hero's scrim does
// the contrast work), so the wordmark is the white tone and every control is a
// white outline or a white pill.
//
// It is absolutely positioned rather than sticky: the wrapper's overflowX
// guard makes it a scroll container, which silently breaks position:sticky —
// and the page is short (hero + three sections + footer), so the navigation
// lives at the top where the visitor decides, with the footer carrying the
// durable links below.
//
// Secondary navigation lives in the menu panel at every breakpoint — the
// header itself never grows an inline link row. The panel closes on Escape,
// returns focus to the button, and locks the page behind it while open.

const BAR_HEIGHT = 64

function scrollToAnchor(id) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
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
    <a
      href={`#${link.anchor}`}
      onClick={(e) => { e.preventDefault(); onNavigate?.(); scrollToAnchor(link.anchor) }}
      style={style}
    >
      {link.label}
    </a>
  )
}

export default function SiteNav() {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  // "Sign in" only joins the header when both buttons still fit beside the
  // logo; below 768px it lives in the menu panel instead of squeezing the bar.
  const showSignIn = !isMobile
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close the panel on Escape, and hand focus back to the button that opened
  // it so keyboard users are not stranded at the top of the document.
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

  // Stop the page behind the panel from scrolling while it is open.
  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [menuOpen])

  const outlineButton = {
    minWidth: 44,
    minHeight: 44,
    padding: '0 18px',
    borderRadius: theme.radius.full,
    border: '1px solid rgba(255,255,255,0.45)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <header
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        background: 'transparent',
      }}
    >
      <nav
        aria-label="Primary"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '10px 20px',
          minHeight: BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Link
          to={ROUTES.home}
          aria-label="CareFind home"
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', minHeight: 44 }}
        >
          <Logo size={26} tone="light" />
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {showSignIn && (
            <button type="button" onClick={() => navigate(ROUTES.login)} style={outlineButton}>
              Sign in
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(ROUTES.search)}
            style={{
              minHeight: 44,
              padding: '0 20px',
              borderRadius: theme.radius.full,
              border: 'none',
              background: '#fff',
              color: theme.tealDeep,
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Get started
          </button>
          <button
            type="button"
            ref={menuRef}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="landing-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            style={{
              ...outlineButton,
              width: 44,
              padding: 0,
              borderRadius: theme.radius.md,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div
          id="landing-menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 20,
            width: 'min(340px, calc(100vw - 40px))',
            maxHeight: 'calc(100vh - 96px)',
            overflowY: 'auto',
            padding: '10px 16px 16px',
            borderRadius: theme.radius.xl,
            background: 'rgba(6,32,26,0.97)',
            border: '1px solid rgba(255,255,255,0.16)',
            boxShadow: '0 24px 60px rgba(4, 20, 16, 0.5)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.label}
                link={link}
                onNavigate={closeMenu}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                  textDecoration: 'none',
                  padding: '13px 4px',
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                }}
              />
            ))}
          </div>

          {!showSignIn && (
            <button
              type="button"
              onClick={() => { closeMenu(); navigate(ROUTES.login) }}
              style={{
                width: '100%',
                minHeight: 44,
                marginTop: 14,
                borderRadius: theme.radius.md,
                border: '1px solid rgba(255,255,255,0.45)',
                background: 'transparent',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Sign in
            </button>
          )}
        </div>
      )}
    </header>
  )
}
