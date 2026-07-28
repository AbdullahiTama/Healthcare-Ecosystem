import { Link } from 'react-router-dom'
import { Bell, Search } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar } from '../ui'
import Logo from '../../modules/social-feed/Logo.jsx'

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

          <Link to={user ? '/profile' : '/login'} style={{ textDecoration: 'none' }}>
            <Avatar name={myUsername} src={myAvatar} size={36} />
          </Link>
        </div>
      </div>
    </header>
  )
}
