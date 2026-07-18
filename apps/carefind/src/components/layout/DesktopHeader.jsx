import { Link } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { Avatar } from '../ui'
import Logo from '../../modules/social-feed/Logo.jsx'

// Desktop/tablet top bar. Same logo, colors, and destinations as the mobile
// header (Feed.jsx's own app bar) — just laid out horizontally instead of
// stacked, per the brief's "maintain current branding, do not redesign the
// logo" constraint.
export default function DesktopHeader({ user, myUsername, myAvatar, unreadNotifs }) {
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 24,
        height: 64, padding: '0 24px',
        background: theme.cardBg, borderBottom: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
      }}
    >
      <Link to="/" style={{ flexShrink: 0 }}>
        <Logo size={28} tone="dark" />
      </Link>

      <Link
        to="/search"
        style={{
          flex: 1, maxWidth: 420, display: 'flex', alignItems: 'center', gap: 8,
          minHeight: 40, padding: '0 14px', borderRadius: theme.radius.md,
          background: theme.gray50, border: `1px solid ${theme.border}`,
          color: theme.textLight, fontSize: 13, textDecoration: 'none',
        }}
      >
        <span aria-hidden="true">🔍</span>
        Search medication, facility, doctor…
      </Link>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link
          to="/notifications"
          aria-label="Notifications"
          style={{
            position: 'relative', width: 40, height: 40, borderRadius: theme.radius.md,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.gray50, textDecoration: 'none', fontSize: 16,
          }}
        >
          🔔
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
    </header>
  )
}
