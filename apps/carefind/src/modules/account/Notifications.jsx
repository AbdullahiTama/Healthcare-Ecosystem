import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'

function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    load()
  }, [user])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('id, type, message, link, post_id, read, created_at, actor_id, profiles!notifications_actor_id_fkey(full_name, display_name, is_verified)')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setItems(data || [])
    setLoading(false)
    // Mark all as read
    if ((data || []).some(n => !n.read)) {
      await supabase.from('notifications').update({ read: true }).eq('recipient_id', user.id).eq('read', false)
    }
  }

  function iconFor(type) {
    switch (type) {
      case 'like': return '❤️'
      case 'comment': return '💬'
      case 'reply': return '↩️'
      case 'gift': return '🎁'
      case 'follow': return '👤'
      case 'news_like': return '❤️'
      case 'news_comment': return '💬'
      case 'product_available': return '💊'
      default: return '🔔'
    }
  }

  function actorName(n) {
    return n.profiles?.full_name || n.profiles?.display_name || 'Someone'
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }
      : { fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 640, margin: '0 auto' }}>
      <div style={{
        background: theme.heroGradient, color: '#fff',
        ...(isMobile ? { padding: '20px 18px 22px', borderRadius: '0 0 24px 24px' } : { padding: '22px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Link to="/" style={{ color: 'rgba(255,255,255,0.75)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Feed</Link>
          </div>
        )}
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: isMobile ? '12px 0 0 0' : 0 }}>🔔 Notifications</h1>
      </div>

      <div style={isMobile ? { padding: '12px 16px 0' } : {}}>
        {loading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading…</p>}

        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '50px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>No notifications yet</h3>
            <p style={{ fontSize: 13, color: theme.textLight, margin: 0 }}>When people interact with you, it'll show up here.</p>
          </div>
        )}

        {items.map((n) => {
          const inner = (
            <div style={{
              display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 14, marginBottom: 8,
              background: n.read ? theme.cardBg : '#ecfdf5', border: `1px solid ${n.read ? theme.border : theme.tealBright}`,
            }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{iconFor(n.type)}</div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: 13.5, color: theme.textDark, lineHeight: 1.4 }}>
                  <strong style={{ color: theme.navy }}>{actorName(n)}</strong>
                  {n.profiles?.is_verified && <span style={{ color: theme.tealDeep, marginLeft: 3 }}>✓</span>}
                  {' '}{n.message}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(n.created_at)}</p>
              </div>
              {!n.read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: theme.tealDeep, flexShrink: 0, marginTop: 6 }} />}
            </div>
          )
          return n.link
            ? <Link key={n.id} to={n.link} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{inner}</Link>
            : <div key={n.id}>{inner}</div>
        })}
      </div>

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/')}>
      {bodyContent}
    </AppShell>
  )
}

export default Notifications
