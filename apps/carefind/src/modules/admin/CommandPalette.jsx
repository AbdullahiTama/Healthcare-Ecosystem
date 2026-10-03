import { useState, useEffect, useRef, useMemo } from 'react'
import {
  LayoutDashboard, Bell, UserCheck, Flag, FileText, Image, Newspaper, Radio,
  ShoppingBag, DollarSign, Landmark, Building2, Users, Shield,
  Pill, ClipboardList, Target, Search, LogOut, RotateCcw, Clock,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { NAV_GROUPS } from './AdminSidebar'

const ALL_TABS = NAV_GROUPS.flatMap(g =>
  g.items.map(item => ({ ...item, group: g.label, type: 'tab' }))
)

const QUICK_ACTIONS = [
  { key: 'signout', label: 'Sign out', icon: LogOut, group: 'Actions', type: 'action', action: 'onSignOut' },
  { key: 'refresh', label: 'Refresh data', icon: RotateCcw, group: 'Actions', type: 'action', action: 'onRefresh' },
]

function fuzzyMatch(query, text) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return true
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function scoreMatch(query, item) {
  const q = query.toLowerCase()
  const label = item.label.toLowerCase()
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.includes(q)) return 60
  return 10
}

export default function CommandPalette({ open, onClose, onNavigate, onSignOut, onRefresh, permissions }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false)

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = useMemo(() => {
    const tabs = ALL_TABS.filter(t => permissions?.[t.key] !== false)
    const all = [...tabs, ...QUICK_ACTIONS]

    if (!query.trim()) return all

    return all
      .filter(item => fuzzyMatch(query, item.label))
      .sort((a, b) => scoreMatch(query, b) - scoreMatch(query, a))
  }, [query, permissions])

  useEffect(() => { setActiveIndex(0) }, [query])

  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function handleSelect(item) {
    if (item.type === 'tab') {
      onNavigate(item.key)
    } else if (item.action === 'onSignOut') {
      onSignOut()
    } else if (item.action === 'onRefresh') {
      onRefresh()
    }
    onClose()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault()
      handleSelect(filtered[activeIndex])
    }
  }

  if (!open) return null

  const grouped = filtered.reduce((acc, item, idx) => {
    const last = acc[acc.length - 1]
    if (!last || last.group !== item.group) {
      acc.push({ group: item.group, items: [{ ...item, _idx: idx }] })
    } else {
      last.items.push({ ...item, _idx: idx })
    }
    return acc
  }, [])

  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)
  const shortcutHint = isMac ? '⌘K' : 'Ctrl+K'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'flex-start',
        justifyContent: 'center',
        paddingTop: isMobile ? 0 : '15vh',
        background: theme.overlay,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        animation: `cpFadeIn ${theme.motion.base} ${theme.motion.easeOut}`,
      }}
    >
      <style>{`
        @keyframes cpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cpSlideUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: isMobile ? '100%' : '100%',
          maxWidth: 560,
          maxHeight: isMobile ? '100vh' : '420px',
          background: theme.cardBg,
          borderRadius: isMobile ? 0 : theme.radius.lg,
          boxShadow: theme.elevation[4],
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: `cpSlideUp ${theme.motion.base} ${theme.motion.easeOut}`,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: `1px solid ${theme.border}`,
          gap: 10,
        }}>
          <Search size={18} color={theme.gray400} style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 15,
              fontWeight: 500,
              fontFamily: theme.fontFamily,
              color: theme.textDark,
              padding: 0,
            }}
          />
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: theme.gray400,
            background: theme.gray100,
            padding: '3px 7px',
            borderRadius: theme.radius.sm,
            border: `1px solid ${theme.border}`,
            letterSpacing: '0.02em',
            flexShrink: 0,
          }}>
            {shortcutHint}
          </span>
        </div>

        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 0',
          }}
        >
          {filtered.length === 0 && (
            <div style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: theme.gray400,
              fontSize: 13,
              fontWeight: 500,
            }}>
              No results found
            </div>
          )}

          {grouped.map(section => (
            <div key={section.group}>
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: theme.gray400,
                padding: '10px 16px 4px',
              }}>
                {section.group}
              </div>
              {section.items.map(item => {
                const Icon = item.icon
                const isActive = item._idx === activeIndex
                return (
                  <div
                    key={item.key}
                    data-index={item._idx}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIndex(item._idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 16px',
                      cursor: 'pointer',
                      background: isActive ? theme.tealMist : 'transparent',
                      borderRadius: 0,
                      transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
                    }}
                  >
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: theme.radius.sm,
                      background: isActive ? theme.tealDeep + '14' : theme.gray100,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon size={14} color={isActive ? theme.tealDeep : theme.gray500} />
                    </div>
                    <span style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 600,
                      color: isActive ? theme.tealDeep : theme.textDark,
                    }}>
                      {item.label}
                    </span>
                    {item.type === 'tab' && (
                      <span style={{
                        fontSize: 10,
                        color: theme.gray400,
                        fontWeight: 600,
                      }}>
                        {item.group}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: '8px 16px',
          borderTop: `1px solid ${theme.border}`,
          fontSize: 10,
          color: theme.gray400,
          fontWeight: 600,
        }}>
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  )
}
