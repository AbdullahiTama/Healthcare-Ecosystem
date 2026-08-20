import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { getMyNotifications, markNotificationRead, markAllNotificationsRead } from '../../services/supabase'
import { watchTable } from '../../lib/realtime'
import { theme } from '../../styles/theme'
import { useToast, Toast } from '../ui'

const NOTIFICATION_CATEGORIES = {
  APPOINTMENTS: 'appointments',
  INVENTORY_EXPIRY: 'inventory_expiry',
  CAREFIND_SOCIAL: 'carefind_social',
}

const CATEGORY_LABELS = {
  [NOTIFICATION_CATEGORIES.APPOINTMENTS]: 'Appointments',
  [NOTIFICATION_CATEGORIES.INVENTORY_EXPIRY]: 'Inventory & Expiry',
  [NOTIFICATION_CATEGORIES.CAREFIND_SOCIAL]: 'CareFind Social',
}

const CATEGORY_COLORS = {
  [NOTIFICATION_CATEGORIES.APPOINTMENTS]: { bg: theme.warningBg, border: theme.warning, text: theme.warning },
  [NOTIFICATION_CATEGORIES.INVENTORY_EXPIRY]: { bg: theme.infoBg, border: theme.info, text: theme.info },
  [NOTIFICATION_CATEGORIES.CAREFIND_SOCIAL]: { bg: theme.tealMist, border: theme.tealDeep, text: theme.tealDeep },
}

const CATEGORY_ICONS = {
  [NOTIFICATION_CATEGORIES.APPOINTMENTS]: 'Calendar',
  [NOTIFICATION_CATEGORIES.INVENTORY_EXPIRY]: 'AlertTriangle',
  [NOTIFICATION_CATEGORIES.CAREFIND_SOCIAL]: 'MessageCircle',
}

function timeAgo(d) {
  if (!d) return ''
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

function getCategory(type) {
  if (type === NOTIFICATION_TYPES.BOOKING_CREATED || type === NOTIFICATION_TYPES.BOOKING_PAID || type === NOTIFICATION_TYPES.BOOKING_CONFIRMED) {
    return NOTIFICATION_CATEGORIES.APPOINTMENTS
  }
  if (type === NOTIFICATION_TYPES.PRODUCT_EXPIRING_SOON) {
    return NOTIFICATION_CATEGORIES.INVENTORY_EXPIRY
  }
  if (type === NOTIFICATION_TYPES.MESSAGE || type === NOTIFICATION_TYPES.COMMENT || type === NOTIFICATION_TYPES.REPLY || type === NOTIFICATION_TYPES.LIKE) {
    return NOTIFICATION_CATEGORIES.CAREFIND_SOCIAL
  }
  return 'all'
}

export default function NotificationBell({ brand }) {
  const navigate = useNavigate()
  const authData = readAuth()
  const meStaffId = (authData && authData.staff && authData.staff.id) ? authData.staff.id : null
  const meName = (authData && authData.staff && authData.staff.full_name)
    ? authData.staff.full_name
    : ((authData && authData.brand && authData.brand.owner) ? authData.brand.owner : 'Owner')
  const meTitle = (authData && authData.staff)
    ? (authData.staff.public_title || authData.staff.role || 'Staff')
    : 'Owner'
  const isOwner = meStaffId === null

  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

  // Track read/unread state per notification ID
  const [readState, setReadState] = useState({})

  // Category filter state
  const [activeCategory, setActiveCategory] = useState('all')

  // Compute unread counts per category
  const [unreadCounts, setUnreadCounts] = useState({
    [NOTIFICATION_CATEGORIES.APPOINTMENTS]: 0,
    [NOTIFICATION_CATEGORIES.INVENTORY_EXPIRY]: 0,
    [NOTIFICATION_CATEGORIES.CAREFIND_SOCIAL]: 0,
    all: 0,
  })

  useEffect(function () { load() }, [brand?.id])

  // New notifications land without a refresh.
  useEffect(function () {
    if (!brand || !brand.id) return
    const stop = watchTable('staff_notifications', brand.id, function (row) {
      const mine = meStaffId ? row.staff_id === meStaffId : row.is_owner === true
      if (!mine) return
      setItems(function (prev) {
        if (prev.some(function (n) { return n.id === row.id })) return prev
        return [row].concat(prev)
      })
      // Update read state for new notification
      setReadState(function (prev) {
        prev[row.id] = !!row.read_at
        return { ...prev }
      })
      // Update unread counts
      updateUnreadCounts()
    })
    return function () { stop() }
  }, [brand?.id])

  async function load() {
    if (!brand || !brand.id) return
    try {
      const rows = await getMyNotifications(brand.id, meStaffId)
      setItems(rows || [])
      // Initialize read state for all loaded items
      const initialReadState = {}
      ;(rows || []).forEach(n => {
        initialReadState[n.id] = !!n.read_at
      })
      setReadState(initialReadState)
      updateUnreadCounts()
    } catch (e) {
      // Silent — a failed notification fetch must not break the dashboard.
    }
  }

  function updateUnreadCounts() {
    const counts = {
      [NOTIFICATION_CATEGORIES.APPOINTMENTS]: 0,
      [NOTIFICATION_CATEGORIES.INVENTORY_EXPIRY]: 0,
      [NOTIFICATION_CATEGORIES.CAREFIND_SOCIAL]: 0,
      all: 0,
    }
    items.forEach(n => {
      const category = getCategory(n.type)
      if (!n.read_at) {
        counts[category] = (counts[category] || 0) + 1
        counts.all = counts.all + 1
      }
    })
    setUnreadCounts(counts)
  }

  async function openItem(n) {
    try {
      if (!n.read_at) {
        await markNotificationRead(n.id)
        setItems(function (prev) {
          return prev.map(function (x) {
            if (x.id !== n.id) return x
            const copy = { ...x }
            copy.read_at = new Date().toISOString()
            return copy
          })
        })
        setReadState(function (prev) {
          prev[n.id] = true
          return { ...prev }
        })
      }
    } catch (e) {}
    setOpen(false)
    if (n.link) navigate('/dashboard/' + n.link)
  }

  async function clearAll() {
    try {
      await markAllNotificationsRead(brand.id, meStaffId)
      setItems(function (prev) {
        const stamp = new Date().toISOString()
        return prev.map(function (x) {
          const copy = { ...x }
          if (!copy.read_at) copy.read_at = stamp
          return copy
        })
      })
      setReadState(function (prev) {
        const newState = {}
        ;(prev || []).forEach(n => { newState[n.id] = true })
        return newState
      })
      updateUnreadCounts()
    } catch (e) {
      showToast('Could not mark all as read: ' + e.message, { type: 'error' })
    }
  }

  function renderCategoryTabs() {
    return (
      <div style={{ display: 'flex', gap: 4, marginBottom: '12px' }}>
        {Object.entries(NOTIFICATION_CATEGORIES).map(([key, value]) => {
          const isActive = activeCategory === value || (activeCategory === 'all' && unreadCounts[value] > 0)
          const hasUnread = unreadCounts[value] > 0
          return (
            <button
              key={key}
              onClick={() => setActiveCategory(value)}
              style={{
                padding: '6px 12px',
                borderRadius: theme.radius.md,
                border: 'none',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
                color: isActive ? 'white' : gray600,
                background: isActive ? CATEGORY_COLORS[value].bg : 'white',
                border: isActive ? `1px solid ${CATEGORY_COLORS[value].border}` : `1px solid ${gray100}`,
              }}
            >
              {CATEGORY_LABELS[value]}
              {hasUnread && (
                <span style={{ marginLeft: '4px', background: CATEGORY_COLORS[value].text, color: 'white', fontSize: '9px', fontWeight: '700', borderRadius: '9px', minWidth: '14px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {unreadCounts[value]}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  const filteredItems = activeCategory === 'all'
    ? items
    : items.filter(n => getCategory(n.type) === activeCategory)

  const totalUnread = unreadCounts.all

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={function () { setOpen(!open) }}
        style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 10px', borderRadius: theme.radius.md, border: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '12px', textAlign: 'left',
          background: totalUnread > 0 ? dangerBg : gray100,
          color: totalUnread > 0 ? danger : gray600 }}>
        <Bell size={15} />
        Notifications
        {totalUnread > 0 && (
          <span style={{ marginLeft: 'auto', background: danger, color: 'white', fontSize: '10px', fontWeight: '900', minWidth: '18px', height: '18px', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
          <button onClick={function () { setOpen(false) }} aria-label="Close notifications" style={{ position: 'absolute', inset: 0, background: 'none', border: 'none', cursor: 'pointer', width: '100%' }} />
          <div onClick={function (e) { e.stopPropagation() }}
            style={{ position: 'absolute', top: '0', left: '0', bottom: '0', width: '340px', maxWidth: '90vw', background: 'white', boxShadow: '4px 0 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
 
            <div style={{ padding: '18px 18px 14px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '900', color: navy }}>Notifications</div>
                <div style={{ fontSize: '11.5px', color: gray400, marginTop: '2px' }}>
                  {totalUnread > 0 ? totalUnread + ' unread' : 'All caught up'}
                </div>
              </div>
              {renderCategoryTabs()}
              <button onClick={function () { setOpen(false) }}
                style={{ flexShrink: 0, background: gray100, border: 'none', borderRadius: '8px', padding: '6px 11px', fontSize: '12px', fontWeight: '700', color: gray600, cursor: 'pointer' }}>
                Close
              </button>
            </div>

            {filteredItems.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>Nothing yet</div>
                <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>
                  You will be told here when an order needs you, or someone sends you correspondence.
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredItems.map(function (n) {
                const isNew = !n.read_at
                const category = getCategory(n.type)
                const catColor = CATEGORY_COLORS[category]
                return (
                  <button key={n.id} onClick={function () { openItem(n) }}
                    style={{ width: '100%', textAlign: 'left', padding: '14px 18px', border: 'none', borderBottom: `1px solid ${gray100}`, cursor: 'pointer',
                      background: isNew ? catColor.bg : 'white',
                      borderLeft: isNew ? `3px solid ${catColor.text}` : '3px solid transparent' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: isNew ? '800' : '600', color: navy }}>
                        {n.title}
                      </span>
                      <span style={{ fontSize: '10px', color: gray400, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    {n.body && (
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '3px', lineHeight: '1.45' }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: '10px', color: gray400, marginTop: '4px' }}>
                      {CATEGORY_LABELS[category]}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}