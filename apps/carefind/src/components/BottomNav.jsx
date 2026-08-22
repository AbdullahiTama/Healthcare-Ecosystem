import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../config/supabaseClient'
import { useAuth } from '../providers/AuthContext'
import { Home, Newspaper, Plus, User, Compass } from 'lucide-react'
import { theme } from '../styles/theme'
import { CREATE_PATH, logCreateTap } from '../modules/social-feed/createSelector.js'

function BottomNav({ onCompose }) {
  const location = useLocation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isActive = (path) => location.pathname === path
  const isHomeActive = location.pathname === '/feed'
  const [unreadNews, setUnreadNews] = useState(0)

  const itemStyle = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    color: active ? theme.tealDeep : theme.textLight, textDecoration: 'none', fontSize: 10, fontWeight: 700,
  })

  // iOS-style tab: the active icon sits in a soft teal capsule so the current
  // screen reads at a glance, even at a small tap size.
  const iconCapsule = (active) => ({
    width: 38, height: 26, borderRadius: 9, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? theme.tealMist : 'transparent',
    transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
  })

  useEffect(() => {
    async function loadUnread() {
      if (!user) { setUnreadNews(0); return }
      // When did this user last open the News page?
      const { data: prof } = await supabase
        .from('profiles')
        .select('news_last_seen')
        .eq('id', user.id)
        .maybeSingle()
      const lastSeen = prof?.news_last_seen || '1970-01-01'
      // Count approved news published since then
      const { count } = await supabase
        .from('news')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'approved')
        .gt('published_at', lastSeen)
      setUnreadNews(count || 0)
    }
    loadUnread()
  }, [user, location.pathname])

  // Create always shows the selector first — never a silent drop into the
  // Text Post composer. See modules/social-feed/createSelector.js for why the
  // previous "scroll to #post-composer, fall back to onCompose" shape made the
  // selector disappear. The feed passes an onCompose that opens the modal in
  // place; every other screen navigates to the feed carrying the create flag.
  function handleCompose() {
    if (onCompose) {
      onCompose()
      logCreateTap({ source: 'bottom-nav', opened: true, path: location.pathname })
      return
    }
    navigate(CREATE_PATH)
    logCreateTap({ source: 'bottom-nav-navigate', opened: true, path: location.pathname })
  }

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480, background: theme.cardBg, borderTop: `1px solid ${theme.border}`,
      display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: 2,
      padding: '8px 6px calc(8px + env(safe-area-inset-bottom)) 6px',
      boxShadow: '0 -2px 10px rgba(0,0,0,0.04)', zIndex: 100,
    }}>
      <Link to="/feed" style={itemStyle(isHomeActive)}>
        <span style={iconCapsule(isHomeActive)}>
          <Home size={20} strokeWidth={isHomeActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        Home
      </Link>
      <Link to="/search" style={itemStyle(isActive('/search'))}>
        <span style={iconCapsule(isActive('/search'))}>
          <Compass size={20} strokeWidth={isActive('/search') ? 2.4 : 2} aria-hidden="true" />
        </span>
        MedMarket
      </Link>
      <button
        onClick={handleCompose}
        style={{
          width: 44, height: 44, borderRadius: theme.radius.md, background: theme.tealDeep,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          border: 'none', cursor: 'pointer', boxShadow: theme.elevation[2],
          transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}`,
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)' }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
        aria-label="Create post"
      >
        <Plus size={22} strokeWidth={2.6} aria-hidden="true" />
      </button>
      <Link to="/news" style={{ ...itemStyle(isActive('/news')), position: 'relative' }}>
        <span style={iconCapsule(isActive('/news'))}>
          <Newspaper size={20} strokeWidth={isActive('/news') ? 2.4 : 2} aria-hidden="true" />
        </span>
        News
        {unreadNews > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: 10, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
            border: `1.5px solid ${theme.cardBg}`,
          }}>
            {unreadNews > 99 ? '99+' : unreadNews}
          </span>
        )}
      </Link>
      <Link to="/profile" style={itemStyle(isActive('/profile'))}>
        <span style={iconCapsule(isActive('/profile'))}>
          <User size={20} strokeWidth={isActive('/profile') ? 2.4 : 2} aria-hidden="true" />
        </span>
        Profile
      </Link>
    </div>
  )
}

export default BottomNav
