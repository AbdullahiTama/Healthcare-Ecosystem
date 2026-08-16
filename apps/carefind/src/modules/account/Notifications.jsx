import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AtSign, Bell, Gift, Heart, MessageCircle, Pill, Reply, UserPlus,
} from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Card, CardSkeleton, Empty } from '../../components/ui'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'

// Each notification type gets its own icon and semantic colour — the icon is
// what a user actually scans for when catching up, so it has to distinguish
// "someone liked this" from "someone paid you" at a glance (ICONS.md: an
// icon's colour always communicates something).
const NOTIFICATION_KIND = {
  like:              { Icon: Heart,         tint: theme.danger },
  news_like:         { Icon: Heart,         tint: theme.danger },
  comment:           { Icon: MessageCircle, tint: theme.info },
  news_comment:      { Icon: MessageCircle, tint: theme.info },
  comment_like:      { Icon: Heart,         tint: theme.danger },
  reply:             { Icon: Reply,         tint: theme.info },
  mention:           { Icon: AtSign,        tint: theme.tealDeep },
  gift:              { Icon: Gift,          tint: theme.tealDeep },
  follow:            { Icon: UserPlus,      tint: theme.tealDeep },
  profile_view:      { Icon: UserPlus,      tint: theme.gray500 },
  product_available: { Icon: Pill,          tint: theme.success },
}

const DEFAULT_KIND = { Icon: Bell, tint: theme.gray500 }

// Notification types whose target is a single feed post. When the row carries
// a post_id, these deep-link to the post itself (/feed?post=<id>) instead of
// the bare '/'-'/feed' fallback stored on the row. Everything else (news,
// follows, payments, product alerts) keeps its own link.
const POST_LINK_TYPES = new Set(['like', 'comment', 'reply', 'repost', 'gift'])

function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    load()
  }, [user])

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('notifications')
      .select('id, type, message, link, post_id, read, created_at, actor_id, profiles!notifications_actor_id_fkey(full_name, display_name, is_verified, specialty, verification_label)')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    setLoading(false)

    if (loadError) {
      // A silent empty list reads as "nothing happened", which is a very
      // different message from "we couldn't load this".
      setError(loadError.message || 'We could not load your notifications.')
      return
    }

    setItems(data || [])
    // Mark all as read
    if ((data || []).some(n => !n.read)) {
      await supabase.from('notifications').update({ read: true }).eq('recipient_id', user.id).eq('read', false)
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
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 90 }
      : { fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile ? { padding: '20px 18px 22px', borderRadius: '0 0 24px 24px' } : { padding: '22px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && (
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.75)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            <ArrowLeft size={15} aria-hidden="true" /> Feed
          </Link>
        )}
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 900, margin: isMobile ? '12px 0 0 0' : 0 }}>
          <Bell size={22} aria-hidden="true" /> Notifications
        </h1>
      </div>

      <div style={isMobile ? { padding: '12px 16px 0' } : {}}>
        {loading && (
          <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading notifications</span>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        )}

        {!loading && error && (
          <Empty
            icon={<Bell size={40} color={theme.gray300} strokeWidth={1.5} />}
            message={
              <>
                <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>We couldn't load your notifications</div>
                <div style={{ fontSize: 13, color: theme.gray500 }}>{error}</div>
              </>
            }
            action="Try again"
            onAction={load}
          />
        )}

        {!loading && !error && items.length === 0 && (
          <Empty
            icon={<Bell size={44} color={theme.gray300} strokeWidth={1.5} />}
            message={
              <>
                <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>No notifications yet</div>
                <div style={{ fontSize: 13, color: theme.gray500 }}>When people interact with you, it shows up here.</div>
              </>
            }
          />
        )}

        {items.map((n) => {
          const { Icon, tint } = NOTIFICATION_KIND[n.type] || DEFAULT_KIND
          const to = n.post_id && POST_LINK_TYPES.has(n.type) ? `/feed?post=${n.post_id}` : n.link
          const inner = (
            <Card style={{
              display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, marginBottom: 8,
              background: n.read ? theme.cardBg : theme.tealMist,
              border: `1px solid ${n.read ? theme.border : theme.tealBright}`,
            }}>
              <span style={{
                width: 36, height: 36, borderRadius: theme.radius.md, flexShrink: 0,
                background: n.read ? theme.gray50 : '#fff', color: tint,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={18} aria-hidden="true" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 3px 0', fontSize: 13.5, color: theme.textMid, lineHeight: 1.45 }}>
                  <strong style={{ color: theme.navy, fontWeight: 800 }}>{actorName(n)}</strong>
                  {<VerifiedBadge profile={n.profiles} size={13} style={{ marginLeft: 3 }} />}
                  {' '}{n.message}
                </p>
                <p style={{ margin: 0, fontSize: 11.5, color: theme.gray400, fontWeight: 600 }}>
                  <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                </p>
              </div>
              {!n.read && (
                <span
                  role="img"
                  aria-label="Unread"
                  style={{ width: 8, height: 8, borderRadius: '50%', background: theme.tealDeep, flexShrink: 0, marginTop: 8 }}
                />
              )}
            </Card>
          )
          return to
            ? <Link key={n.id} to={to} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{inner}</Link>
            : <div key={n.id}>{inner}</div>
        })}
      </div>

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
      {bodyContent}
    </AppShell>
  )
}

export default Notifications
