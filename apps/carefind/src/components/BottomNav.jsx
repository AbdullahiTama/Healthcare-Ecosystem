import { Link, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { Home, Compass, Newspaper, User, Plus } from 'lucide-react'
import { theme } from '../styles/theme'
import { useAuth } from '../providers/AuthContext'
import { CREATE_PATH, logCreateTap } from '../modules/social-feed/createSelector.js'

function BottomNav({ onCompose }) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const rawTab = searchParams.get('tab')
  const tab = rawTab || 'shop' // default marketplace tab is Shop per spec

  const isFeed = location.pathname === '/feed'
  const isProfile = location.pathname === '/profile'
  const isSearch = location.pathname === '/search'
  const isNews = location.pathname === '/news' || location.pathname.startsWith('/news/')

  // 4-item: Home | Browse | News | Profile — per latest instruction Shop replaced by News
  // Home → /feed, Browse → marketplace (any /search tab), News → /news, Profile → /profile
  const isHomeActive = isFeed
  const browseActive = isSearch
  const isNewsActive = isNews
  const isProfileActive = isProfile

  function handleCompose() {
    if (onCompose) {
      logCreateTap({ source: 'bottom-nav', route: 'in-place', path: location.pathname })
      onCompose()
      return
    }
    logCreateTap({ source: 'bottom-nav', route: 'navigate', path: location.pathname })
    navigate(CREATE_PATH)
  }

  const itemStyle = (active) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    color: active ? theme.tealDeep : theme.textLight,
    textDecoration: 'none',
    fontSize: 10,
    fontWeight: 800,
    minWidth: 0,
    flex: 1,
    padding: '4px 0',
  })

  const iconCapsule = (active) => ({
    width: 38,
    height: 26,
    borderRadius: 9,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? theme.tealMist : 'transparent',
    transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
  })

  // Straight line: all items in one horizontal row, equally spaced, no floating
  const showCreate = !!(onCompose || ['/feed', '/profile', '/news'].includes(location.pathname))

  return (
    <div
      role="navigation"
      aria-label="Primary"
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        background: theme.cardBg,
        borderTop: `1px solid ${theme.border}`,
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        gap: 2,
        padding: '8px 6px calc(8px + env(safe-area-inset-bottom)) 6px',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.04)',
        zIndex: 100,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <Link to="/feed" style={itemStyle(isHomeActive)} aria-current={isHomeActive ? 'page' : undefined}>
        <span style={iconCapsule(isHomeActive)}>
          <Home size={20} strokeWidth={isHomeActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Home
      </Link>
      <Link
        to="/search?tab=businesses"
        style={itemStyle(browseActive)}
        aria-current={browseActive ? 'page' : undefined}
      >
        <span style={iconCapsule(browseActive)}>
          <Compass size={20} strokeWidth={browseActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Browse
      </Link>
      {showCreate && (
        <button
          onClick={handleCompose}
          aria-label="Create post"
          style={{
            ...itemStyle(false),
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            flex: 1,
          }}
        >
          <span
            style={{
              ...iconCapsule(false),
              background: theme.tealDeep,
              color: '#fff',
            }}
          >
            <Plus size={18} strokeWidth={2.6} aria-hidden="true" color="#fff" />
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, color: theme.textLight }}>Create</span>
        </button>
      )}
      <Link
        to="/news"
        style={itemStyle(isNewsActive)}
        aria-current={isNewsActive ? 'page' : undefined}
      >
        <span style={iconCapsule(isNewsActive)}>
          <Newspaper size={20} strokeWidth={isNewsActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        News
      </Link>
      <Link to="/profile" style={itemStyle(isProfileActive)} aria-current={isProfileActive ? 'page' : undefined}>
        <span style={iconCapsule(isProfileActive)}>
          <User size={20} strokeWidth={isProfileActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Profile
      </Link>
    </div>
  )
}

export default BottomNav
