import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { getMyNotifications, markNotificationRead, markAllNotificationsRead } from '../../services/supabase'
import { watchTable } from '../../lib/realtime'
import { theme } from '../../styles/theme'
import { useToast, Toast } from '../ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, bg } = theme

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

export default function NotificationBell({ brand }) {
  const navigate = useNavigate()
  const authData = readAuth()
  const meStaffId = (authData && authData.staff && authData.staff.id) ? authData.staff.id : null

  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

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
    })
    return function () { stop() }
  }, [brand?.id])

  async function load() {
    if (!brand || !brand.id) return
    try {
      const rows = await getMyNotifications(brand.id, meStaffId)
      setItems(rows || [])
    } catch (e) {
      // Silent — a failed notification fetch must not break the dashboard.
    }
  }

  const unread = items.filter(function (n) { return !n.read_at })

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
    } catch (e) {
      showToast('Could not mark all as read: ' + e.message, { type: 'error' })
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={function () { setOpen(!open) }}
        style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 10px', borderRadius: theme.radius.md, border: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '12px', textAlign: 'left',
          background: unread.length > 0 ? dangerBg : gray100,
          color: unread.length > 0 ? danger : gray600 }}>
        <Bell size={15} />
        Notifications
        {unread.length > 0 && (
          <span style={{ marginLeft: 'auto', background: danger, color: 'white', fontSize: '10px', fontWeight: '900', minWidth: '18px', height: '18px', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
            {unread.length > 99 ? '99+' : unread.length}
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
                  {unread.length > 0 ? unread.length + ' unread' : 'All caught up'}
                </div>
              </div>
              <button onClick={function () { setOpen(false) }}
                style={{ flexShrink: 0, background: gray100, border: 'none', borderRadius: '8px', padding: '6px 11px', fontSize: '12px', fontWeight: '700', color: gray600, cursor: 'pointer' }}>
                Close
              </button>
            </div>

            {unread.length > 0 && (
              <button onClick={clearAll}
                style={{ padding: '10px 18px', background: bg, border: 'none', borderBottom: `1px solid ${border}`, textAlign: 'left', fontSize: '12px', fontWeight: '700', color: tealDeep, cursor: 'pointer' }}>
                Mark all as read
              </button>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {items.length === 0 && (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>Nothing yet</div>
                  <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>
                    You will be told here when an order needs you, or someone sends you correspondence.
                  </div>
                </div>
              )}

              {items.map(function (n) {
                const isNew = !n.read_at
                return (
                  <button key={n.id} onClick={function () { openItem(n) }}
                    style={{ width: '100%', textAlign: 'left', padding: '14px 18px', border: 'none', borderBottom: `1px solid ${gray100}`, cursor: 'pointer',
                      background: isNew ? tealMist : 'white',
                      borderLeft: isNew ? `3px solid ${tealDeep}` : '3px solid transparent' }}>
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
