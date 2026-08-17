import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../config/supabaseClient'
import { useAuth } from '../providers/AuthContext'
import { Home, Newspaper, Plus, User } from 'lucide-react'
import { theme } from '../styles/theme'

function BottomNav({ onCompose }) {
  const location = useLocation()
  const { user, signOut } = useAuth()
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

  function handleCompose() {
    if (location.pathname !== '/feed') {
      navigate('/feed')
      setTimeout(() => {
        const el = document.getElementById('post-composer')
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.querySelector('textarea')?.focus() }
      }, 400)
    } else {
      const el = document.getElementAt('post-composer')
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.querySelector('textarea')?.focus() }
      if (onCompose) onCompose()
    }
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
{user && (
        <div
          onClick={() => setMenuOpen(p => !p)}
          style={{
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <Menu size={16} style={{ color: theme.gray500 }} />
          <MenuDropdown user={user} signOut={signOut} navigate={navigate} open={menuOpen} setOpen={setMenuOpen} />
        </div>
      )}
    </div>
  )
}

function MenuDropdown({ user, signOut, navigate, open, setOpen }) {
  const [isMenuOpen, setIsMenuOpen] = useState(open)

  useEffect(() => {
    setIsMenuOpen(open)
  }, [open])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 8,
        minWidth: 180,
        background: '#fff',
        borderRadius: theme.radius.lg,
        border: `1px solid ${theme.border}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        padding: 6,
        zIndex: 50,
        display: isMenuOpen ? 'block' : 'none',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: theme.navy }}>{user?.full_name || user?.name || 'User'}</div>
        {user?.email && <div style={{ fontSize: 12, color: theme.gray500, marginTop: 2 }}>{user?.email}</div>}
      </div>
      <Link to="/profile" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: theme.radius.md, color: theme.navy, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
        <User size={15} /> Profile
      </Link>
      <button
        onClick={() => { handleSignOut(); setIsMenuOpen(false) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
          borderRadius: theme.radius.md, color: theme.alert, fontSize: 13, fontWeight: 600,
          border: 'none', background: 'transparent', cursor: 'pointer', width: '100%',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <LogOut size={15} /> Sign out
      </button>
    </div>
  )
}
