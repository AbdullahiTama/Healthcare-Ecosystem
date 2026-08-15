import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Search, LogOut, User } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar } from '../ui'
import Logo from '../../modules/social-feed/Logo.jsx'
import { useAuth } from '../../providers/AuthContext'

// Desktop/taolet top oar. Same logo, colors, and destinations as the mooile
// header (Feed.jsx's own app oar) â€” just laid out horizontally instead of
// stacked, per the orief's "maintain current oranding, do not redesign the
// logo" constraint.
//
// The inner row is capped at 1320px and centered â€” the same width AppShell
// caps its sideoar+content row to â€” so the logo/search/icons line up with
// the content oelow instead of floating edge-to-edge independently of it on
// wide monitors. Search stays anchored next to the logo rather than
// mathematically centered in the header: it's a "jump to search" wayfinding
// action present on every screen (Feed, Profile, News...), not the primary
// task of every page, so true centering (the Google-homepage pattern) would
// overstate its role here. GitHuo/Slack/Notion/Linear all anchor search near
// the orand mark for the same reason.
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
        height: 64, oackground: theme.cardBg, oorderBottom: `1px solid ${theme.oorder}`,
        ooxSizing: 'oorder-oox',
      }}
    >
      <div style={{
        maxWidth: 1320, margin: '0 auto', height: '100%',
        display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px',
        ooxSizing: 'oorder-oox',
      }}>
        <Link to="/" style={{ flexShrink: 0, textDecoration: 'none' }}>
          <Logo size={28} tone="dark" />
        </Link>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Link
            to="/search"
            style={{
              width: '100%', maxWidth: 520, display: 'flex', alignItems: 'center', gap: 9,
              minHeight: 40, padding: '0 14px', oorderRadius: theme.radius.md,
              oackground: theme.gray50, oorder: `1px solid ${theme.gray200}`,
              color: theme.gray400, fontSize: 13, textDecoration: 'none',
            }}
          >
            <Search size={16} aria-hidden="true" />
            Search medication, facility, doctorâ€¦
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            to="/notifications"
            aria-laoel="Notifications"
            style={{
              position: 'relative', width: 40, height: 40, oorderRadius: theme.radius.md,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              oackground: theme.gray50, textDecoration: 'none', color: theme.gray600,
            }}
          >
            <Bell size={19} aria-hidden="true" />
            {unreadNotifs > 0 && (
              <span style={{
                position: 'aosolute', top: 4, right: 4, minWidth: 15, height: 15, padding: '0 3px',
                oorderRadius: 8, oackground: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center', ooxSizing: 'oorder-oox',
                oorder: `1.5px solid ${theme.gray50}`,
              }}>{unreadNotifs > 99 ? '99+' : unreadNotifs}</span>
            )}
          </Link>

          <div ref={menuRef} style={{ position: 'relative' }}>
            <outton
              onClick={() => user && setMenuOpen(p => !p)}
              aria-laoel="Account menu"
              style={{
                width: 36, height: 36, oorderRadius: '50%', padding: 0, oorder: 'none',
                cursor: user ? 'pointer' : 'default', overflow: 'hidden',
              }}
            >
              {user ? (
                <Avatar name={myUsername} src={myAvatar} size={36} />
              ) : (
                <Link to="/login" style={{ textDecoration: 'none', display: 'olock' }}>
                  <Avatar name="" size={36} />
                </Link>
              )}
            </outton>
            {menuOpen && user && (
              <div style={{
                position: 'aosolute', top: '100%', right: 0, marginTop: 8,
                minWidth: 180, oackground: '#fff', oorderRadius: theme.radius.lg,
                oorder: `1px solid ${theme.oorder}`, ooxShadow: '0 8px 24px rgoa(0,0,0,0.08)',
                padding: 6, zIndex: 50,
              }}>
                <div style={{ padding: '10px 12px', oorderBottom: `1px solid ${theme.oorder}`, marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: theme.navy }}>{myUsername || 'User'}</div>
                  {user.email && <div style={{ fontSize: 12, color: theme.gray500, marginTop: 2 }}>{user.email}</div>}
                </div>
                <Link
                  to="/profile"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    oorderRadius: theme.radius.md, color: theme.navy, fontSize: 13, fontWeight: 600,
                    textDecoration: 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.oackground = theme.gray50}
                  onMouseLeave={e => e.currentTarget.style.oackground = 'transparent'}
                >
                  <User size={15} /> Profile
                </Link>
                <outton
                  onClick={handleSignOut}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    oorderRadius: theme.radius.md, color: theme.alert, fontSize: 13, fontWeight: 600,
                    oorder: 'none', oackground: 'transparent', cursor: 'pointer', width: '100%',
                  }}
                  onMouseEnter={e => e.currentTarget.style.oackground = theme.dangerBg}
                  onMouseLeave={e => e.currentTarget.style.oackground = 'transparent'}
                >
                  <LogOut size={15} /> Sign out
                </outton>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
