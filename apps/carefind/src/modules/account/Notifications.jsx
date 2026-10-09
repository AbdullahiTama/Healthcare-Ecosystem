import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AtSign, Bell, CreditCard, Gift, Heart, MessageCircle, Package, Pill, Radio, Repeat2, Reply,
  RotateCcw, ShoppingBag, Star, Stethoscope, Truck, UserPlus, XCircle,
} from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { profileRepository } from './repositories/profileRepository'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Card, CardSkeleton, Empty } from '../../components/ui'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { STATUS_CONFIG } from '../shop/orderConstants'
import { notificationHref, orderIdOf, presentNotification, wantsOrderDetail } from './notificationPresentation'

// What a notification says is decided by notificationPresentation.js; this page only maps its icon and tone keys onto
// lucide icons and theme colours. The icon is what a user scans for when catching up, so its colour always
// communicates something (ICONS.md: an icon's colour is never decoration).
const ICONS = {
  heart: Heart, message: MessageCircle, reply: Reply, mention: AtSign, gift: Gift, follow: UserPlus, repost: Repeat2,
  star: Star, stethoscope: Stethoscope, live: Radio, pill: Pill, bag: ShoppingBag, card: CreditCard, package: Package,
  truck: Truck, cancel: XCircle, refund: RotateCcw, bell: Bell,
}

const TONES = {
  danger: theme.danger,
  info: theme.info,
  brand: theme.tealDeep,
  success: theme.success,
  warning: theme.warning,
  muted: theme.gray500,
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function actorNameOf(n) {
  return n.profiles?.full_name || n.profiles?.display_name || ''
}

function NotificationRow({ n, order }) {
  const view = presentNotification(n, { actorName: actorNameOf(n), order })
  // An order status row takes its icon and colour from the same table the order page uses, so "Ready for pickup"
  // looks the same here as there.
  const status = view.statusKey ? STATUS_CONFIG[view.statusKey] : null
  const Icon = status?.icon || ICONS[view.iconKey] || Bell
  const tint = status?.color || TONES[view.tone] || theme.gray500
  const to = notificationHref(n)
  const isSystem = view.voice === 'system'

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
        {isSystem ? (
          <p style={{ margin: '0 0 3px 0', fontSize: 14, fontWeight: 800, color: theme.navy, lineHeight: 1.45 }}>{view.headline}</p>
        ) : (
          <p style={{ margin: '0 0 3px 0', fontSize: 13.5, color: theme.textMid, lineHeight: 1.45 }}>
            <strong style={{ color: theme.navy, fontWeight: 800 }}>{view.lead}</strong>
            {n.profiles && <VerifiedBadge profile={n.profiles} size={13} style={{ marginLeft: 3 }} />}
            {' '}{view.headline.slice(view.lead.length).trim()}
          </p>
        )}
        {view.body && (
          <p style={{ margin: '0 0 3px 0', fontSize: 13, color: theme.textMid, lineHeight: 1.5 }}>{view.body}</p>
        )}
        {view.facts.length > 0 && (
          <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', margin: '4px 0 3px 0' }}>
            {view.facts.map((f) => (
              <div key={f.label} style={{ display: 'flex', gap: 5, minWidth: 0, fontSize: 12.5 }}>
                <dt style={{ color: theme.gray500, fontWeight: 600 }}>{f.label}</dt>
                <dd style={{ margin: 0, color: theme.navy, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
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

  return (
    <li>
      {to
        ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{inner}</Link>
        : inner}
    </li>
  )
}

function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [items, setItems] = useState([])
  const [orders, setOrders] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    load()
  }, [user])

  // The total and items of the orders these notifications are about, in ONE query. The order is the customer's own
  // (RLS: shop_orders "customer select"), so nothing here can read anyone else's. Strictly additive: the stored
  // sentence already says what happened, so if this fails the list simply shows less, and the page never fails with it.
  async function loadOrderDetail(rows) {
    const ids = [...new Set(rows.filter(wantsOrderDetail).map(orderIdOf))]
    if (!ids.length) return
    try {
      const { data, error: orderError } = await supabase
        .from('shop_orders')
        .select('id, total_kobo, shop_order_items(product_name, quantity)')
        .in('id', ids)
      if (orderError) throw orderError
      setOrders(Object.fromEntries((data || []).map((o) => [o.id, o])))
    } catch (err) {
      console.warn('[notifications] order detail unavailable', err?.message)
    }
  }

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
    loadOrderDetail(data || [])
    // Mark all as read
    if ((data || []).some(n => !n.read)) {
      try {
        await profileRepository.markNotificationsRead(user.id)
      } catch (err) {
        console.warn('[notifications] could not mark as read', err?.message)
      }
    }
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }
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
                <div style={{ fontSize: 13, color: theme.gray500 }}>Order and payment updates, and when people interact with you, show up here.</div>
              </>
            }
          />
        )}

        {!loading && !error && items.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((n) => <NotificationRow key={n.id} n={n} order={orders[orderIdOf(n)]} />)}
          </ul>
        )}
      </div>

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
      {bodyContent}
    </AppShell>
  )
}

export default Notifications
