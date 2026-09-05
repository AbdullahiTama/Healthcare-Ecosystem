import { Link, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { Home, Store, Newspaper, User, Plus } from 'lucide-react'
import { theme } from '../styles/theme'
import { CREATE_PATH, logCreateTap } from '../modules/social-feed/createSelector.js'

function BottomNav({ onCompose }) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const isFeed = location.pathname === '/feed'
  const isProfile = location.pathname === '/profile'
  const isSearch = location.pathname === '/search'
  const isNews = location.pathname === '/news' || location.pathname.startsWith('/news/')

  const isHomeActive = isFeed
  const isMedMarketActive = isSearch
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
    justifyContent: 'center',
    gap: 2,
    color: active ? theme.tealDeep : theme.textLight,
    textDecoration: 'none',
    fontSize: 10,
    fontWeight: 800,
    flex: 1,
    padding: '6px 0 2px',
    WebkitTapHighlightColor: 'transparent',
  })

  const iconCapsule = (active) => ({
    width: 40,
    height: 28,
    borderRadius: 10,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? theme.tealMist : 'transparent',
    transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
  })

  return (
    <nav
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
        alignItems: 'center',
        justifyContent: 'space-around',
        gap: 2,
        padding: '6px 4px calc(6px + env(safe-area-inset-bottom)) 4px',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.04)',
        zIndex: 100,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <Link to="/feed" style={itemStyle(isHomeActive)} aria-current={isHomeActive ? 'page' : undefined}>
        <span style={iconCapsule(isHomeActive)}>
          <Home size={20} strokeWidth={isHomeActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Home
      </Link>
      <Link
        to="/search?tab=shop"
        style={itemStyle(isMedMarketActive)}
        aria-current={isMedMarketActive ? 'page' : undefined}
      >
        <span style={iconCapsule(isMedMarketActive)}>
          <Store size={20} strokeWidth={isMedMarketActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        MedMarket
      </Link>
      <button
        onClick={handleCompose}
        aria-label="Create post"
        style={{
          ...itemStyle(false),
          background: 'none',
          border: 'none',
          cursor: 'pointer',
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
    </nav>
  )
}

export default BottomNav
