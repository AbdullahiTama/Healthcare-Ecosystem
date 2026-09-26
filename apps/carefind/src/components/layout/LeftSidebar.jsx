import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Compass, Newspaper, Wallet, Bookmark, Bell, Plus } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar } from '../ui'
import { CREATE_PATH, logCreateTap } from '../../modules/social-feed/createSelector.js'

const NAV_PRIMARY = [
  { to: '/feed', label: 'Home', Icon: Home, end: true },
  { to: '/search', label: 'Discover', Icon: Compass },
  { to: '/news', label: 'News', Icon: Newspaper },
]

const NAV_PERSONAL = [
  { to: '/wallet', label: 'Wallet', Icon: Wallet },
  { to: '/saved', label: 'Saved', Icon: Bookmark },
  { to: '/notifications', label: 'Notifications', Icon: Bell },
]

function NavRow({ item, active, collapsed, badge }) {
  const cls = [
    'cf-nav-row',
    active ? 'cf-nav-row--active' : '',
  ].filter(Boolean).join(' ')

  return (
    <Link
      to={item.to}
      className={cls}
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
    >
      <item.Icon size={21} strokeWidth={active ? 2.4 : 2} color={active ? theme.tealDeep : theme.gray500} style={{ flexShrink: 0 }} aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
      {badge > 0 && (
        <span className="cf-notif-badge" style={{
          position: collapsed ? 'absolute' : 'static', top: collapsed ? 4 : undefined, right: collapsed ? 4 : undefined,
          marginLeft: collapsed ? 0 : 'auto',
          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
          background: theme.danger, color: '#fff', fontSize: 10, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
      {collapsed && <span className="cf-collapsed-tooltip">{item.label}</span>}
    </Link>
  )
}

function NavSectionLabel({ children }) {
  return <div className="cf-nav-section-label">{children}</div>
}

export default function LeftSidebar({ user, myUsername, myAvatar, unreadNotifs, onCompose, collapsed = false }) {
  const location = useLocation()
  const navigate = useNavigate()

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
      className="cf-left-sidebar"
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
        background: theme.cardBg,
        boxSizing: 'border-box',
        gap: 2,
      }}
    >
      {user && (
        <button
          onClick={handleCompose}
          className="cf-create-btn"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            minHeight: 44, marginBottom: 12, padding: collapsed ? 0 : '11px 20px',
            border: 'none', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
          }}
          aria-label="Create post"
        >
          <Plus size={19} strokeWidth={2.6} aria-hidden="true" />{!collapsed && <span>Create</span>}
        </button>
      )}

      {!collapsed && <NavSectionLabel>Navigate</NavSectionLabel>}
      {NAV_PRIMARY.map((item) => (
        <NavRow
          key={item.to}
          item={item}
          collapsed={collapsed}
          active={item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)}
          badge={0}
        />
      ))}

      {!collapsed && <div style={{ height: 8 }} />}
      {!collapsed && <NavSectionLabel>Personal</NavSectionLabel>}
      {NAV_PERSONAL.map((item) => (
        <NavRow
          key={item.to}
          item={item}
          collapsed={collapsed}
          active={location.pathname.startsWith(item.to)}
          badge={item.to === '/notifications' ? unreadNotifs : 0}
        />
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${theme.hairline}` }}>
        <Link
          to={user ? '/profile' : '/login'}
          className="cf-profile-link"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
            padding: collapsed ? '10px 0' : '10px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <Avatar name={myUsername} src={myAvatar} size={34} />
          {!collapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user ? (myUsername || 'My profile') : 'Log in'}
              </span>
              {user && (
                <span style={{ fontSize: 11, fontWeight: 500, color: theme.gray500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  View profile
                </span>
              )}
            </div>
          )}
          {collapsed && <span className="cf-collapsed-tooltip">{user ? (myUsername || 'My profile') : 'Log in'}</span>}
        </Link>
      </div>
    </nav>
  )
}
