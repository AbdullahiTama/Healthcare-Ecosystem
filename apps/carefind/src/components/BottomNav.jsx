import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../config/supabaseClient'
import { useAuth } from '../providers/AuthContext'
import { Home, Compass, Plus, Newspaper, User } from 'lucide-react'
import { theme } from '../styles/theme'

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
    if (location.pathname !== '/feed') {
      navigate('/feed')
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
      <Link to="/feed" style={itemStyle(isActive('/feed'))}>
        <Home size={20} strokeWidth={isActive('/feed') ? 2.4 : 2} aria-hidden="true" />
        Home
      </Link>
      <Link to="/search" style={itemStyle(isActive('/search'))}>
        <Compass size={20} strokeWidth={isActive('/search') ? 2.4 : 2} aria-hidden="true" />
        MedMarket
      </Link>
      <button
        onClick={handleCompose}
        style={{
          width: 44, height: 44, borderRadius: theme.radius.md, background: theme.tealDeep,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          border: 'none', cursor: 'pointer',
        }}
        aria-label="Create post"
      >
        <Plus size={22} strokeWidth={2.6} aria-hidden="true" />
      </button>
      <Link to="/news" style={{ ...itemStyle(isActive('/news')), position: 'relative' }}>
        <Newspaper size={20} strokeWidth={isActive('/news') ? 2.4 : 2} aria-hidden="true" />
        News
        {unreadNews > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: 6, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: theme.danger, color: '#fff', fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
          }}>
            {unreadNews > 99 ? '99+' : unreadNews}
          </span>
        )}
      </Link>
      <Link to="/profile" style={itemStyle(isActive('/profile'))}>
        <User size={20} strokeWidth={isActive('/profile') ? 2.4 : 2} aria-hidden="true" />
        Profile
      </Link>
    </div>
  )
}

export default BottomNav
