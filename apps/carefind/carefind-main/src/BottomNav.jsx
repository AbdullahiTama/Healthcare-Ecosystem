import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'

function BottomNav({ onCompose }) {
  const location = useLocation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isActive = (path) => location.pathname === path
  const [unreadNews, setUnreadNews] = useState(0)

  const itemStyle = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    color: active ? theme.tealDeep : theme.textLight, textDecoration: 'none', fontSize: 10, fontWeight: 700,
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

  function handleCompose() {
    if (location.pathname !== '/') {
      navigate('/')
      setTimeout(() => {
        const el = document.getElementById('post-composer')
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.querySelector('textarea')?.focus() }
      }, 400)
    } else {
      const el = document.getElementById('post-composer')
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.querySelector('textarea')?.focus() }
      if (onCompose) onCompose()
    }
  }

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480, background: theme.cardBg, borderTop: `1px solid ${theme.border}`,
      display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '10px 0 18px 0',
      boxShadow: '0 -2px 10px rgba(0,0,0,0.04)', zIndex: 100,
    }}>
      <Link to="/" style={itemStyle(isActive('/'))}>
        <span style={{ fontSize: 19 }}>🏠</span>
        Home
      </Link>
      <Link to="/search" style={itemStyle(isActive('/search'))}>
        <span style={{ fontSize: 19 }}>🛒</span>
        MedMarket
      </Link>
      <button
        onClick={handleCompose}
        style={{
          width: 42, height: 42, borderRadius: 13, background: theme.tealGradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          fontSize: 22, fontWeight: 800, boxShadow: '0 4px 12px rgba(15,118,110,0.4)',
          border: 'none', cursor: 'pointer',
        }}
      >
        +
      </button>
      <Link to="/news" style={{ ...itemStyle(isActive('/news')), position: 'relative' }}>
        <span style={{ fontSize: 19 }}>📰</span>
        News
        {unreadNews > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: 6, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
          }}>
            {unreadNews > 99 ? '99+' : unreadNews}
          </span>
        )}
      </Link>
      <Link to="/profile" style={itemStyle(isActive('/profile'))}>
        <span style={{ fontSize: 19 }}>👤</span>
        Profile
      </Link>
    </div>
  )
}

export default BottomNav
