import { Link, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { Home, Compass, ShoppingBag, User, Plus } from 'lucide-react'
import { theme } from '../styles/theme'
import { useAuth } from '../providers/AuthContext'
import { CREATE_PATH, logCreateTap } from '../modules/social-feed/createSelector.js'

function BottomNav({ onCompose }) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const tab = searchParams.get('tab')

  const isMarketplace = location.pathname === '/search' || location.pathname === '/shop' || location.pathname.startsWith('/shop/')
  const isFeed = location.pathname === '/feed'
  const isProfile = location.pathname === '/profile'

  // Spec §30: Home | Browse | Shop | Profile — Shop active inside marketplace
  // Home → /feed, Browse → /search (general browse), Shop → /shop (/search?tab=shop), Profile → /profile
  // Inside marketplace (/search) Shop is highlighted regardless of top tab per spec's strict wording
  const isHomeActive = isFeed
  const isShopActive = isMarketplace
  const browseActive = !isShopActive && location.pathname === '/search' && tab && tab !== 'shop'
  const shopActive = isShopActive

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
        alignItems: 'flex-start',
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
        to="/search"
        style={itemStyle(browseActive)}
        aria-current={browseActive ? 'page' : undefined}
      >
        <span style={iconCapsule(browseActive)}>
          <Compass size={20} strokeWidth={browseActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Browse
      </Link>
      {/* Create action — not a navigation destination, kept for feed's in-place selector */}
      {(onCompose || location.pathname === '/feed' || location.pathname === '/profile' || location.pathname === '/news') && (
        <button
          onClick={handleCompose}
          aria-label="Create post"
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            background: theme.tealDeep,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            boxShadow: theme.elevation[2],
            flexShrink: 0,
            margin: '0 2px',
            transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}`,
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)' }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          <Plus size={22} strokeWidth={2.6} aria-hidden="true" />
        </button>
      )}
      <Link
        to="/shop"
        style={itemStyle(shopActive)}
        aria-current={shopActive ? 'page' : undefined}
      >
        <span style={iconCapsule(shopActive)}>
          <ShoppingBag size={20} strokeWidth={shopActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Shop
      </Link>
      <Link to="/profile" style={itemStyle(isProfile)} aria-current={isProfile ? 'page' : undefined}>
        <span style={iconCapsule(isProfile)}>
          <User size={20} strokeWidth={isProfile ? 2.4 : 2} aria-hidden="true" />
        </span>
        Profile
      </Link>
    </div>
  )
}

export default BottomNav
