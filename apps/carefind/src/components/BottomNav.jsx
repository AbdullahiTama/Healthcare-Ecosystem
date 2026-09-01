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
  const rawTab = searchParams.get('tab')
  const tab = rawTab || 'shop' // default marketplace tab is Shop per spec

  const isFeed = location.pathname === '/feed'
  const isProfile = location.pathname === '/profile'
  const isSearch = location.pathname === '/search'
  const isShopRoute = location.pathname === '/shop' || location.pathname.startsWith('/shop/') || location.pathname.startsWith('/cart') || location.pathname.startsWith('/wishlist') || location.pathname.startsWith('/orders')

  // Consistent 4-item: Home | Browse | Shop | Profile
  // Browse → Facilities browse, Shop → commerce. Top tabs are Shop|Products|Facilities|Professionals
  // Bottom Browse highlights when top is Products/Facilities/Professionals, Shop when top is Shop
  const isHomeActive = isFeed
  const browseActive = isSearch && ['products', 'businesses', 'professionals'].includes(tab)
  const shopActive = (isSearch && tab === 'shop') || isShopRoute
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

  // Show create as floating action, not inside flex row, so Browse and Shop stay adjacent and consistent
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
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 0,
        padding: showCreate ? '6px 6px calc(8px + env(safe-area-inset-bottom)) 6px' : '8px 6px calc(8px + env(safe-area-inset-bottom)) 6px',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.04)',
        zIndex: 100,
        overflow: 'visible',
        boxSizing: 'border-box',
      }}
    >
      {/* Floating Create — centered above the bar, not between Browse and Shop */}
      {showCreate && (
        <div style={{ position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
          <button
            onClick={handleCompose}
            aria-label="Create post"
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: theme.tealDeep,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              border: `3px solid ${theme.cardBg}`,
              cursor: 'pointer',
              boxShadow: theme.elevation[2],
              transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}`,
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)' }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <Plus size={24} strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: 2, width: '100%' }}>
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
        <Link to="/profile" style={itemStyle(isProfileActive)} aria-current={isProfileActive ? 'page' : undefined}>
          <span style={iconCapsule(isProfileActive)}>
            <User size={20} strokeWidth={isProfileActive ? 2.4 : 2} aria-hidden="true" />
          </span>
          Profile
        </Link>
      </div>
    </div>
  )
}

export default BottomNav
