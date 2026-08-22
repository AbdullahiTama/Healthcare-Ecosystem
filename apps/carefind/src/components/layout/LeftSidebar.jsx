import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Compass, Newspaper, Wallet, Bookmark, Bell, Plus } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar } from '../ui'
import { CREATE_PATH, logCreateTap } from '../../modules/social-feed/createSelector.js'

// Desktop/tablet persistent navigation. Maps to CareFind's real, existing
// routes only — no invented destinations (see main.jsx's <Routes>). The
// brief's example nav (Providers/Appointments/Messages) has no corresponding
// page in this app today, so those are intentionally omitted rather than
// linked to nowhere. Icons are lucide (ICONS.md): a single stroke-based set
// across the whole product, never emoji.
const NAV_ITEMS = [
  { to: '/feed', label: 'Home', Icon: Home, end: true },
  { to: '/search', label: 'Discover', Icon: Compass },
  { to: '/news', label: 'News', Icon: Newspaper },
  { to: '/wallet', label: 'Wallet', Icon: Wallet },
  { to: '/saved', label: 'Saved', Icon: Bookmark },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
]

function NavRow({ item, active, collapsed, badge }) {
  return (
    <Link
      to={item.to}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: collapsed ? '12px 0' : '10px 14px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: theme.radius.md,
        textDecoration: 'none',
        color: active ? theme.tealDeep : theme.gray600,
        background: active ? theme.tealMist : 'transparent',
        fontWeight: active ? 800 : 600,
        fontSize: 14,
        position: 'relative',
        minHeight: 44,
        boxSizing: 'border-box',
      }}
      title={collapsed ? item.label : undefined}
    >
      <item.Icon size={21} strokeWidth={active ? 2.4 : 2} color={active ? theme.tealDeep : theme.gray500} style={{ flexShrink: 0 }} aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
      {badge > 0 && (
        <span style={{
          position: collapsed ? 'absolute' : 'static', top: collapsed ? 4 : undefined, right: collapsed ? 4 : undefined,
          marginLeft: collapsed ? 0 : 'auto',
          minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
          background: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </Link>
  )
}

// `collapsed`: tablet's icon-only rail (NAVIGATION.md's documented tablet
// collapse behavior for CareHub's sidebar, applied here for consistency).
export default function LeftSidebar({ user, myUsername, myAvatar, unreadNotifs, onCompose, collapsed = false }) {
  const location = useLocation()
  const navigate = useNavigate()

  // Same contract as BottomNav: create always opens the selector. Pages that
  // cannot open it in place (everything except the feed) navigate to the feed
  // with the create flag rather than dropping the user on a feed that just
  // sits there.
  function handleCompose() {
    if (onCompose) {
      logCreateTap({ source: 'left-sidebar', route: 'in-place', path: location.pathname })
      onCompose()
      return
    }
    logCreateTap({ source: 'left-sidebar', route: 'navigate', path: location.pathname })
    navigate(CREATE_PATH)
  }

  return (
    <nav
      aria-label="Primary"
      style={{
        width: collapsed ? 72 : 240,
        flexShrink: 0,
        position: 'sticky',
        top: 64,
        height: 'calc(100vh - 64px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        padding: collapsed ? '16px 8px' : '20px 12px',
        borderRight: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
        gap: 4,
      }}
    >
      {user && (
        <button
          onClick={handleCompose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            minHeight: 44, marginBottom: 16, padding: collapsed ? 0 : '11px 16px',
            borderRadius: theme.radius.md, border: 'none', background: theme.tealDeep,
            color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
          }}
          aria-label="Create post"
        >
          <Plus size={19} strokeWidth={2.6} aria-hidden="true" />{!collapsed && <span>Create</span>}
        </button>
      )}

      {NAV_ITEMS.map((item) => (
        <NavRow
          key={item.to}
          item={item}
          collapsed={collapsed}
          active={item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)}
          badge={item.to === '/notifications' ? unreadNotifs : 0}
        />
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
        <Link
          to={user ? '/profile' : '/login'}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
            padding: collapsed ? '8px 0' : '8px 10px', borderRadius: theme.radius.md,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <Avatar name={myUsername} src={myAvatar} size={32} />
          {!collapsed && (
            <span style={{ fontSize: 13, fontWeight: 700, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user ? (myUsername || 'My profile') : 'Log in'}
            </span>
          )}
        </Link>
      </div>
    </nav>
  )
}
