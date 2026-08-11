import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Search, LogOut, User } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar } from '../ui'
import Logo from '../../modules/social-feed/Logo.jsx'
import { useAuth } from '../../providers/AuthContext'

// Desktop/tablet top bar. Same logo, colors, and destinations as the mobile
// header (Feed.jsx's own app bar) — just laid out horizontally instead of
// stacked, per the brief's "maintain current branding, do not redesign the
// logo" constraint.
//
// The inner row is capped at 1320px and centered — the same width AppShell
// caps its sidebar+content row to — so the logo/search/icons line up with
// the content below instead of floating edge-to-edge independently of it on
// wide monitors. Search stays anchored next to the logo rather than
// mathematically centered in the header: it's a "jump to search" wayfinding
// action present on every screen (Feed, Profile, News...), not the primary
// task of every page, so true centering (the Google-homepage pattern) would
// overstate its role here. GitHub/Slack/Notion/Linear all anchor search near
// the brand mark for the same reason.
export default function DesktopHeader({ user, myUsername, myAvatar, unreadNotifs }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()
  const { signOut } = useAuth()

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 40,
        height: 64, background: theme.cardBg, borderBottom: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
      }}
    >
      <div style={{
        maxWidth: 1320, margin: '0 auto', height: '100%',
        display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px',
        boxSizing: 'border-box',
      }}>
        <Link to="/" style={{ flexShrink: 0, textDecoration: 'none' }}>
          <Logo size={28} tone="dark" />
        </Link>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Link
            to="/search"
            style={{
              width: '100%', maxWidth: 520, display: 'flex', alignItems: 'center', gap: 9,
              minHeight: 40, padding: '0 14px', borderRadius: theme.radius.md,
              background: theme.gray50, border: `1px solid ${theme.gray200}`,
              color: theme.gray400, fontSize: 13, textDecoration: 'none',
            }}
          >
            <Search size={16} aria-hidden="true" />
            Search medication, facility, doctor…
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            to="/notifications"
            aria-label="Notifications"
            style={{
              position: 'relative', width: 40, height: 40, borderRadius: theme.radius.md,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: theme.gray50, textDecoration: 'none', color: theme.gray600,
            }}
          >
            <Bell size={19} aria-hidden="true" />
            {unreadNotifs > 0 && (
              <span style={{
                position: 'absolute', top: 4, right: 4, minWidth: 15, height: 15, padding: '0 3px',
                borderRadius: 8, background: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                border: `1.5px solid ${theme.cardBg}`,
              }}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>
            )}
          </Link>

          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => user && setMenuOpen(p => !p)}
              aria-label="Account menu"
              style={{
                width: 36, height: 36, borderRadius: '50%', padding: 0, border: 'none',
                cursor: user ? 'pointer' : 'default', overflow: 'hidden',
              }}
            >
              {user ? (
                <Avatar name={myUsername} src={myAvatar} size={36} />
              ) : (
                <Link to="/login" style={{ textDecoration: 'none', display: 'block' }}>
                  <Avatar name="" size={36} />
                </Link>
              )}
            </button>
            {menuOpen && user && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                minWidth: 180, background: '#fff', borderRadius: theme.radius.lg,
                border: `1px solid ${theme.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                padding: 6, zIndex: 50,
              }}>
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: theme.navy }}>{myUsername || 'User'}</div>
                  {user.email && <div style={{ fontSize: 12, color: theme.gray500, marginTop: 2 }}>{user.email}</div>}
                </div>
                <Link
                  to="/profile"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderRadius: theme.radius.md, color: theme.navy, fontSize: 13, fontWeight: 600,
                    textDecoration: 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = theme.gray50}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <User size={15} /> Profile
                </Link>
                <button
                  onClick={handleSignOut}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderRadius: theme.radius.md, color: theme.alert, fontSize: 13, fontWeight: 600,
                    border: 'none', background: 'transparent', cursor: 'pointer', width: '100%',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
