import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Logo } from '../../../components/ui'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { NAV_LINKS } from '../data/navigation'

// Sticky bar, not a floating pill.
//
// The previous nav was a 720px glass pill that inverted between white and
// translucent teal on scroll and removed Features and Pricing outright below
// 768px — leaving those two sections unreachable on a phone. This one keeps
// every destination reachable at every width and makes exactly one state
// change when scrolled: a hairline and a little more shadow.
export function NavBar() {
  const { isMobileOrTablet } = useBreakpoint()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const toggleRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Collapse the panel when the layout grows past the mobile breakpoint,
  // otherwise a phone-sized menu stays mounted on a desktop window.
  useEffect(() => {
    if (!isMobileOrTablet) setOpen(false)
  }, [isMobileOrTablet])

  useEffect(() => {
    if (!open) return

    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    const onPointer = (e) => {
      if (panelRef.current?.contains(e.target) || toggleRef.current?.contains(e.target)) return
      setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  const height = isMobileOrTablet ? 60 : 68

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(247, 245, 239, 0.86)',
        backdropFilter: 'blur(16px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
        borderBottom: scrolled ? `1px solid ${theme.border}` : '1px solid transparent',
        boxShadow: scrolled ? theme.elevation[2] : 'none',
        transition: `box-shadow ${theme.motion.base} ${theme.motion.easeOut}, border-color ${theme.motion.base} ${theme.motion.easeOut}`,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          height,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <Link
          to="/"
          aria-label="CareHub home"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            textDecoration: 'none',
            marginRight: 'auto',
          }}
        >
          <Logo size={28} />
          <span
            style={{
              fontWeight: 900,
              fontSize: 16,
              letterSpacing: '-0.01em',
              color: theme.navy,
            }}
          >
            CareHub
          </span>
        </Link>

        {!isMobileOrTablet && (
          <nav aria-label="Primary">
            <ul
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                listStyle: 'none',
                margin: 0,
                padding: 0,
              }}
            >
              {NAV_LINKS.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    style={{
                      display: 'inline-block',
                      padding: '8px 12px',
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: theme.gray600,
                      textDecoration: 'none',
                      borderRadius: theme.radius.md,
                    }}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            to="/login"
            style={{
              display: isMobileOrTablet ? 'none' : 'inline-flex',
              alignItems: 'center',
              minHeight: 40,
              padding: '0 14px',
              fontSize: 13.5,
              fontWeight: 600,
              color: theme.navy,
              textDecoration: 'none',
              borderRadius: theme.radius.full,
            }}
          >
            Sign in
          </Link>

          <Link
            to="/register"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: isMobileOrTablet ? 40 : 44,
              padding: isMobileOrTablet ? '0 16px' : '0 20px',
              background: theme.tealDeep,
              color: '#ffffff',
              fontSize: 13.5,
              fontWeight: 700,
              textDecoration: 'none',
              borderRadius: theme.radius.full,
              whiteSpace: 'nowrap',
            }}
          >
            Get started free
          </Link>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            style={{
              display: isMobileOrTablet ? 'inline-flex' : 'none',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              marginRight: -4,
              background: '#ffffff',
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.md,
              color: theme.navy,
              cursor: 'pointer',
            }}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="landing-mobile-nav"
          ref={panelRef}
          style={{
            borderTop: `1px solid ${theme.border}`,
            background: 'var(--bg)',
            padding: '12px 24px 20px',
            maxHeight: 'calc(100dvh - 60px)',
            overflowY: 'auto',
          }}
        >
          <nav aria-label="Mobile">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {NAV_LINKS.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'block',
                      padding: '13px 4px',
                      fontSize: 15,
                      fontWeight: 600,
                      color: theme.navy,
                      textDecoration: 'none',
                      borderBottom: `1px solid ${theme.border}`,
                    }}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 10, paddingTop: 16 }}>
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  background: '#ffffff',
                  color: theme.navy,
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                Sign in
              </Link>
              <Link
                to="/register"
                onClick={() => setOpen(false)}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  borderRadius: theme.radius.md,
                  background: theme.tealDeep,
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                Get started free
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
